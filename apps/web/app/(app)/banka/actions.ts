'use server';
/**
 * Server actions of Изводи / Девизни изводи (legacy ACT `autoMatch`, `autoAll`, `numIzv`, `delBank`, `undoImp`,
 * `addBankAcct`, `rmBankAcct`, `unlinkBank`, `flipBank`, `addRule`, `rmRule`, `bkPickSave`, `mbSave`, `feeFix`,
 * `trClose`, change listeners `data-bk`, `data-izv*`). Every action: firm from the session, `requireCan`, one
 * transaction with the posting service and an audit row.
 */
import * as XLSX from 'xlsx';
import {
  detectStatementFormat, parseBankTable, parseStatementFile, type Statement,
} from '@wise/core';
import {
  addManualLine, addRule, applyFeeFix, applyMatches, closeTransit, deleteLine, deleteStatement, flipLine, linkLine, numberStatements,
  planImport, removeBankAccount, removeRule, saveBankAccount, saveImport, setLineKonto, setLinePartner, undoImport, unlinkLine,
  updateStatement, type ImportPlan,
} from '@wise/db';
import { firmAction } from '@/lib/books';
import { bankRun, isDate, num, str } from '@/lib/bank';
import { db } from '@/lib/db';
import type { FormState } from '@/components/action-form';

const P = ['/banka', '/devizni', '/bkAdv', '/nalozi'];
const MAX = 20 * 1024 * 1024;

/** A file-reading problem shown to the user (handled like the bank services' domain errors). */
const fail = (m: string) => Object.assign(new Error(m), { name: 'BankError' });

/* ---------------- import ---------------- */

async function readStatements(f: File): Promise<{ statements: Statement[]; format: string }> {
  if (f.size > MAX) throw fail('Датотеката е преголема (најмногу 20 MB).');
  const bytes = new Uint8Array(await f.arrayBuffer());
  const kind = detectStatementFormat(bytes, f.name);
  if (kind === 'excel') {
    const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: '' });
      const st = parseBankTable(rows);
      if (st) return { statements: [st], format: 'excel' };
    }
    throw fail(`„${f.name}“: не се препознаени колоните (датум, износ / прилив / одлив).`);
  }
  if (kind === 'ai') {
    // TODO(ai): PDF / image statements → Phase 3 AI reading job (legacy `importBankImg`, prompt at 4796), then planImport.
    throw fail(`„${f.name}“: PDF и слики од изводи ќе се читаат со AI (во подготовка). Користете XML, MT940, KB (.300), CSV или Excel.`);
  }
  const S = parseStatementFile(bytes, f.name);
  if (!S || !S.length) throw fail(`„${f.name}“: форматот не е препознаен или нема ставки.`);
  return { statements: S, format: kind };
}

export interface PreviewResult { error?: string; plans?: { file: string; format: string; plan: ImportPlan }[] }

function filesOf(form: FormData): File[] {
  return form.getAll('file').filter((x): x is File => typeof x === 'object' && 'arrayBuffer' in x && (x as File).size > 0);
}

/** Step 1: parse the files and show what would be imported (nothing is written). */
export async function previewImportAction(form: FormData): Promise<PreviewResult> {
  try {
    const { firm } = await firmAction('write');
    const acct = str(form.get('acct')) || null;
    const out: NonNullable<PreviewResult['plans']> = [];
    for (const f of filesOf(form)) {
      const { statements, format } = await readStatements(f);
      const plan = await db().transaction((tx) => planImport(tx, { firmId: firm.id, userId: null, statements, defaultAccountId: acct }));
      out.push({ file: f.name, format, plan });
    }
    if (!out.length) return { error: 'Изберете датотека.' };
    return { plans: out };
  } catch (e) {
    // Next.js redirects / not-found carry a digest and must propagate.
    if (e instanceof Error && 'digest' in e) throw e;
    return { error: e instanceof Error ? e.message : 'Грешка при читање.' };
  }
}

/** Step 2: import (one transaction per file), post complete statements. */
export async function saveImportAction(form: FormData): Promise<FormState> {
  const acct = str(form.get('acct')) || null;
  const skip = form.get('dups') !== 'on';
  const msgs: string[] = [];
  for (const f of filesOf(form)) {
    const r = await bankRun('write', P, async ({ tx, u, firm }) => {
      const { statements, format } = await readStatements(f);
      const x = await saveImport(tx, { firmId: firm.id, userId: u.id, statements, defaultAccountId: acct, skipDuplicates: skip, fileName: f.name, format });
      return `„${f.name}“: ${x.statements} изводи, ${x.lines} ставки${x.skipped ? `, ${x.skipped} дупликати прескокнати` : ''}; прокнижени ${x.posted}, за довршување ${x.drafts}.`;
    });
    if (r.error) return { error: `„${f.name}“: ${r.error}`, ...(msgs.length ? { ok: msgs.join(' ') } : {}) };
    msgs.push(r.ok!);
  }
  return msgs.length ? { ok: msgs.join(' ') } : { error: 'Изберете датотека.' };
}

/* ---------------- matching ---------------- */

export async function applyMatchesAction(_p: FormState, form: FormData): Promise<FormState> {
  const accept = form.getAll('accept').map(String);
  const createPartners = form.getAll('mkp').map(String);
  if (!accept.length) return { error: 'Не е избрана ниту една ставка.' };
  return bankRun('autoMatch', P, async ({ tx, u, firm, year }) => {
    const r = await applyMatches(tx, { firmId: firm.id, userId: u.id, year, accept, createPartners });
    return `Прокнижени ${r.applied} ставки · изводи книжени: ${r.posted}${r.drafts ? `, сè уште за довршување: ${r.drafts}` : ''}.`;
  });
}

export async function linkLineAction(_p: FormState, form: FormData): Promise<FormState> {
  const lineId = str(form.get('line'));
  const docIds = form.getAll('doc').map(String);
  return bankRun('bkPickSave', P, async ({ tx, u, firm, year }) => {
    const r = await linkLine(tx, { firmId: firm.id, userId: u.id, year, lineId, docIds });
    return r.excess ? `Поврзано. Остаток ${(r.excess / 100).toFixed(2)} ден. останува како аванс кај комитентот.` : 'Поврзано.';
  });
}

export async function setKontoAction(_p: FormState, form: FormData): Promise<FormState> {
  const lineId = str(form.get('line'));
  const konto = str(form.get('konto')).split(/\s/)[0]!;
  const partnerId = str(form.get('partner')) || null;
  const learn = form.get('learn') === 'on';
  return bankRun('write', P, ({ tx, u, firm }) => setLineKonto(tx, { firmId: firm.id, userId: u.id, lineId, konto, partnerId, learn }).then(() => 'Прокнижено.'));
}

export async function setPartnerAction(_p: FormState, form: FormData): Promise<FormState> {
  const lineId = str(form.get('line'));
  const partnerId = str(form.get('partner')) || null;
  const createName = str(form.get('create')) || null;
  return bankRun('write', [...P, '/partneri'], ({ tx, u, firm }) => setLinePartner(tx, { firmId: firm.id, userId: u.id, lineId, partnerId, createName }).then(() => 'Комитентот е поставен.'));
}

export async function unlinkLineAction(lineId: string): Promise<FormState> {
  return bankRun('unlinkBank', P, ({ tx, u, firm }) => unlinkLine(tx, { firmId: firm.id, userId: u.id, lineId }).then(() => 'Врската е отстранета.'));
}
export async function flipLineAction(lineId: string): Promise<FormState> {
  return bankRun('flipBank', P, ({ tx, u, firm }) => flipLine(tx, { firmId: firm.id, userId: u.id, lineId }).then(() => 'Насоката е променета.'));
}
/** FIX(4.4 #13): the button asks for confirmation; deleting needs the `del` permission. */
export async function deleteLineAction(lineId: string): Promise<FormState> {
  return bankRun('del', P, ({ tx, u, firm }) => deleteLine(tx, { firmId: firm.id, userId: u.id, lineId }).then(() => 'Избришано.'));
}
export async function deleteStatementAction(statementId: string): Promise<FormState> {
  return bankRun('del', P, ({ tx, u, firm }) => deleteStatement(tx, { firmId: firm.id, userId: u.id, statementId }).then(() => 'Изводот е избришан.'));
}
export async function undoImportAction(batch: string): Promise<FormState> {
  return bankRun('del', P, async ({ tx, u, firm }) => `Поништени ${await undoImport(tx, { firmId: firm.id, userId: u.id, batch })} ставки.`);
}

/* ---------------- statements ---------------- */

export async function updateStatementAction(_p: FormState, form: FormData): Promise<FormState> {
  const statementId = str(form.get('st'));
  const has = (k: string) => form.has(k);
  return bankRun('write', P, ({ tx, u, firm }) => updateStatement(tx, {
    firmId: firm.id, userId: u.id, statementId,
    ...(has('number') ? { number: str(form.get('number')) || null } : {}),
    ...(has('opening') ? { opening: num(form.get('opening')) } : {}),
    ...(has('closing') ? { closing: num(form.get('closing')) } : {}),
    ...(has('sd') ? { statedDebit: num(form.get('sd')) } : {}),
    ...(has('sp') ? { statedCredit: num(form.get('sp')) } : {}),
    ...(has('rate') ? { rate: num(form.get('rate')) } : {}),
  }).then(() => 'Зачувано.'));
}

export async function numberStatementsAction(): Promise<FormState> {
  return bankRun('numIzv', P, async ({ tx, u, firm, year }) => `Нумерирани ${await numberStatements(tx, { firmId: firm.id, userId: u.id, year })} изводи.`);
}

export async function addManualLineAction(_p: FormState, form: FormData): Promise<FormState> {
  const date = str(form.get('date'));
  const amount = num(form.get('amount'));
  const amountCur = num(form.get('amountCur'));
  const desc = str(form.get('desc'));
  if (!isDate(date)) return { error: 'Внесете датум.' };
  if (!desc) return { error: 'Внесете опис.' };
  return bankRun('mbSave', P, async ({ tx, u, firm }) => {
    const id = str(form.get('acct'));
    await addManualLine(tx, {
      firmId: firm.id, userId: u.id, bankAccountId: id, date, amount: amount ?? 0, amountCur, desc,
      konto: str(form.get('konto')).split(/\s/)[0] || null, partnerId: str(form.get('partner')) || null,
    });
    return 'Ставката е додадена.';
  });
}

/* ---------------- rules, fees, transit ---------------- */

export async function addRuleAction(_p: FormState, form: FormData): Promise<FormState> {
  return bankRun('addRule', P, ({ tx, u, firm }) => addRule(tx, { firmId: firm.id, userId: u.id, match: str(form.get('match')), konto: str(form.get('konto')).split(/\s/)[0]! }).then(() => 'Правилото е додадено.'));
}
export async function removeRuleAction(ruleId: string): Promise<FormState> {
  return bankRun('rmRule', P, ({ tx, u, firm }) => removeRule(tx, { firmId: firm.id, userId: u.id, ruleId }).then(() => 'Отстрането.'));
}
export async function feeFixAction(): Promise<FormState> {
  return bankRun('feeFix', P, async ({ tx, u, firm, year }) => `Прекнижани ${await applyFeeFix(tx, { firmId: firm.id, userId: u.id, year })} провизии на 4460.`);
}
export async function closeTransitAction(konto: string, date: string): Promise<FormState> {
  return bankRun('trClose', P, async ({ tx, u, firm }) => `Курсната разлика е книжена (налог ${await closeTransit(tx, { firmId: firm.id, userId: u.id, konto, date })}).`);
}

/* ---------------- bank accounts ---------------- */

export async function saveBankAccountAction(_p: FormState, form: FormData): Promise<FormState> {
  return bankRun('addBankAcct', [...P, '/bankFmt'], async ({ tx, u, firm }) => {
    await saveBankAccount(tx, {
      firmId: firm.id, userId: u.id,
      input: {
        id: str(form.get('id')) || null, name: str(form.get('name')), account: str(form.get('account')) || null, iban: str(form.get('iban')) || null,
        cur: str(form.get('cur')) || 'MKD', konto: str(form.get('konto')).split(/\s/)[0]!, nal: str(form.get('nal')) || null,
      },
    });
    return 'Сметката е зачувана.';
  });
}
export async function removeBankAccountAction(id: string): Promise<FormState> {
  return bankRun('rmBankAcct', [...P, '/bankFmt'], ({ tx, u, firm }) => removeBankAccount(tx, { firmId: firm.id, userId: u.id, id }).then(() => 'Сметката е отстранета.'));
}
