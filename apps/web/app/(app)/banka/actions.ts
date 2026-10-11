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
  addManualLine, addRule, applyBankPartnerFix, applyFeeFix, applyMatches, bookBankPosFee, fillStatementNumbers, closeTransit, deleteLine, deleteStatement, flipLine, linkLine, numberStatements,
  planImport, removeBankAccount, removeRule, saveBankAccount, saveImport, setLineKonto, setLinePartner, undoImport, unlinkLine,
  updateStatement, loadBankAccounts, bankLines, bankAccounts, firms, userFirms, audit, type ImportPlan,
} from '@wise/db';
import { statementFromRead } from '@wise/core/ai/bank';
import { ownerCheck, withNote, type OwnerFirm } from '@wise/core/bank/parity';
import { and, eq, inArray, or } from 'drizzle-orm';
import { firmAction } from '@/lib/books';
import { loadAiResult, markAiReadsSaved } from '@/lib/ai';
import { bankRun, isDate, num, str } from '@/lib/bank';
import { db } from '@/lib/db';
import { runPayNotes } from './paynotes';
import type { FormState } from '@/components/bank-form';

const P = ['/banka', '/devizni', '/bkAdv', '/nalozi'];
const MAX = 20 * 1024 * 1024;

/** A file-reading problem shown to the user (handled like the bank services' domain errors). */
const fail = (m: string) => Object.assign(new Error(m), { name: 'BankError' });

/* ---------------- import ---------------- */

async function readStatements(f: File, firmId: string, aiDoc: string): Promise<{ statements: Statement[]; format: string; fileId?: string | null }> {
  if (aiDoc) {
    // PDF / image statement read by the AI job (legacy `importBankImg` 4796, `BANK_PROMPT`) → the normal import pipeline
    const d = await loadAiResult(firmId, aiDoc, 'bank');
    if (!d) throw fail(`„${f.name}“: изводот сè уште не е прочитан.`);
    const st = statementFromRead(d.result);
    if (!st) throw fail(`„${f.name}“: во изводот не се пронајдени ставки.`);
    // legacy `archiveFile(file,{sub:'Извод'})` 4807: the read file stays linked to the statement
    return { statements: [st], format: 'ai', fileId: d.fileId };
  }
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
    // PDF / images are read by the AI job before the preview (import-box.tsx) and arrive here as `aiDoc`.
    throw fail(`„${f.name}“: форматот не е препознаен. PDF и слики од изводи се читаат автоматски – изберете ја датотеката повторно.`);
  }
  const S = parseStatementFile(bytes, f.name);
  if (!S || !S.length) throw fail(`„${f.name}“: форматот не е препознаен или нема ставки.`);
  return { statements: S, format: kind };
}

/** The user's firms with their bank account numbers (for the owner check across firms). */
async function ownerFirms(u: { id: string; principal: { firms: readonly string[] } }): Promise<OwnerFirm[]> {
  const scoped = u.principal.firms.includes('*') ? undefined
    : or(inArray(firms.id, db().select({ id: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))), eq(firms.ownerId, u.id));
  const F = await db().select({ id: firms.id, name: firms.name, edb: firms.edb }).from(firms).where(scoped);
  const B = F.length ? await db().select({ firmId: bankAccounts.firmId, account: bankAccounts.account, iban: bankAccounts.iban }).from(bankAccounts).where(inArray(bankAccounts.firmId, F.map((f) => f.id))) : [];
  return F.map((f) => ({ ...f, accounts: B.filter((b) => b.firmId === f.id).flatMap((b) => [b.account, b.iban]) }));
}

export interface PreviewResult { error?: string; plans?: { file: string; format: string; plan: ImportPlan }[] }

/** Files with the id of their AI read (`aiDoc`, same order; '' = parse the file itself). */
function filesOf(form: FormData): { f: File; ai: string }[] {
  const ai = form.getAll('aiDoc').map(String);
  return form.getAll('file').flatMap((x, i) => {
    if (typeof x !== 'object' || !('arrayBuffer' in x)) return [];
    const a = /^[0-9a-f-]{36}$/i.test(ai[i] ?? '') ? ai[i]! : '';
    return (x as File).size > 0 || a ? [{ f: x as File, ai: a }] : [];
  });
}

/** Step 1: parse the files and show what would be imported (nothing is written). */
export async function previewImportAction(form: FormData): Promise<PreviewResult> {
  try {
    const { u, firm } = await firmAction('write');
    const acct = str(form.get('acct')) || null;
    const out: NonNullable<PreviewResult['plans']> = [];
    let others: OwnerFirm[] | null = null;
    for (const { f, ai } of filesOf(form)) {
      const { statements, format } = await readStatements(f, firm.id, ai);
      const plan = await db().transaction((tx) => planImport(tx, { firmId: firm.id, userId: null, statements, defaultAccountId: acct }));
      // legacy `ownerCheck` 12880: the statement may belong to another firm of the office (by ЕДБ / account / name)
      for (const st of statements) {
        others ??= await ownerFirms(u);
        const cur = others.find((x) => x.id === firm.id) ?? { id: firm.id, name: firm.name, edb: firm.edb };
        const w = ownerCheck(cur, others, { name: st.owner, acct: st.account || st.iban });
        if (w?.other) plan.warnings.push(w.message);
      }
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
  const replace = form.get('replace') === 'on';
  const msgs: string[] = [];
  for (const { f, ai } of filesOf(form)) {
    const r = await bankRun('write', P, async ({ tx, u, firm }) => {
      const { statements, format, fileId } = await readStatements(f, firm.id, ai);
      const x = await saveImport(tx, { firmId: firm.id, userId: u.id, statements, defaultAccountId: acct, skipDuplicates: skip, fileName: f.name, format, fileId: fileId ?? null, replace });
      if (ai) await markAiReadsSaved(tx, firm.id, [ai]);
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
  return notifyAfter(await bankRun('autoMatch', P, async ({ tx, u, firm, year }) => {
    const r = await applyMatches(tx, { firmId: firm.id, userId: u.id, year, accept, createPartners });
    return `Прокнижени ${r.applied} ставки · изводи книжени: ${r.posted}${r.drafts ? `, сè уште за довршување: ${r.drafts}` : ''}.`;
  }));
}

export async function linkLineAction(_p: FormState, form: FormData): Promise<FormState> {
  const lineId = str(form.get('line'));
  const docIds = form.getAll('doc').map(String);
  return notifyAfter(await bankRun('bkPickSave', P, async ({ tx, u, firm, year }) => {
    const r = await linkLine(tx, { firmId: firm.id, userId: u.id, year, lineId, docIds });
    return r.excess ? `Поврзано. Остаток ${(r.excess / 100).toFixed(2)} ден. останува како аванс кај комитентот.` : 'Поврзано.';
  }));
}

export async function setKontoAction(_p: FormState, form: FormData): Promise<FormState> {
  const lineId = str(form.get('line'));
  const konto = str(form.get('konto')).split(/\s/)[0]!;
  const partnerId = str(form.get('partner')) || null;
  const learn = form.get('learn') === 'on';
  const note = form.has('note') ? str(form.get('note')) : null;
  // legacy toast 4843: „Прокнижено. Запомнато: „key“ → konto; следниот пат автоматски.“
  return bankRun('write', P, ({ tx, u, firm }) => setLineKonto(tx, { firmId: firm.id, userId: u.id, lineId, konto, partnerId, learn })
    .then(async (L) => {
      // legacy `bkPickSave` 12703: „на кого / за што“ is appended to the description as ` · [note]`
      if (note != null) {
        const [l] = await tx.select({ d: bankLines.description }).from(bankLines).where(and(eq(bankLines.id, lineId), eq(bankLines.firmId, firm.id))).limit(1);
        if (l && withNote(l.d, note) !== l.d) await tx.update(bankLines).set({ description: withNote(l.d, note) }).where(eq(bankLines.id, lineId));
      }
      return L;
    })
    .then((L) => (L.length ? `Прокнижено. Запомнато: ${L.map((k) => `„${k.replace('|in', ' (прилив)').replace('|out', ' (одлив)')}“`).join(', ')} → ${konto}; следниот пат автоматски.` : 'Прокнижено.')));
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

/**
 * Legacy `mbNew` / `mbSave` 13255–13296: manual statement line — account, date, direction, the open invoice it
 * closes (amount and partner from the invoice, description „Уплата по фактура N“ / „Плаќање по фактура N“), amount in
 * the account currency (FX: denars by the statement rate), description, konto, partner.
 */
export async function addManualLineAction(_p: FormState, form: FormData): Promise<FormState> {
  const date = str(form.get('date'));
  const dirIn = str(form.get('dir')) !== 'out';
  const sign = dirIn ? 1 : -1;
  // doc = "inv|<id>|<open cents>|<number>|<partner>" or "pur|…"
  const [dt, docId, openC, docNo, docP] = str(form.get('doc')).split('|');
  const doc = docId && (dt === 'inv' || dt === 'pur') ? { id: docId, open: Number(openC) || 0, no: docNo ?? '', partner: docP ?? '' } : null;
  if (doc && (dt === 'inv') !== dirIn) return { error: dirIn ? 'Приливот може да затвора само наша (излезна) фактура.' : 'Одливот може да затвора само влезна фактура.' };
  const a0 = num(form.get('amount'));
  const amt = a0 != null && a0 !== 0 ? Math.abs(a0) : doc ? doc.open / 100 : 0;
  if (!amt) return { error: 'Внесете износ.' };
  const mkd = num(form.get('amountMkd'));
  const desc = str(form.get('desc')) || (doc ? `${dirIn ? 'Уплата' : 'Плаќање'} по фактура ${doc.no}` : dirIn ? 'Уплата' : 'Плаќање');
  if (!isDate(date)) return { error: 'Внесете датум.' };
  return notifyAfter(await bankRun('mbSave', P, async ({ tx, u, firm, year }) => {
    const id = str(form.get('acct'));
    const [acc] = await loadBankAccounts(tx, firm.id).then((A) => A.filter((x) => x.id === id));
    if (!acc) return 'Сметката не постои.';
    const fx = acc.cur !== 'MKD';
    const lineId = await addManualLine(tx, {
      firmId: firm.id, userId: u.id, bankAccountId: id, date,
      amount: fx ? (mkd ? sign * Math.abs(mkd) : 0) : sign * amt, amountCur: fx ? sign * amt : null, desc,
      konto: doc ? null : str(form.get('konto')).split(/\s/)[0] || null, partnerId: (doc?.partner || str(form.get('partner'))) || null,
    });
    if (doc) await linkLine(tx, { firmId: firm.id, userId: u.id, year, lineId, docIds: [doc.id] });
    return doc ? `Ставката е додадена и ја затвора фактурата ${doc.no}.` : 'Ставката е додадена.';
  }));
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
/* ---------------- finance parity ---------------- */

/** After a link to our invoices: legacy `pnRun` payment notifications (never fails the action). */
async function notifyAfter(r: FormState): Promise<FormState> {
  if (r.error) return r;
  try { const { u, firm, year } = await firmAction('write'); await runPayNotes(firm, u.id, year); } catch (e) { console.warn('[pnRun]', (e as Error).message); }
  return r;
}

/** Legacy `pnCard` checkboxes (`saveFirmPatch({autoNotify})`): confirmation to the customer, summary for the office. */
export async function saveAutoNotifyAction(_p: FormState, form: FormData): Promise<FormState> {
  const v = { pay: form.get('pay') === 'on', sum: form.get('sum') === 'on', to: str(form.get('to')).slice(0, 200) };
  if (v.to && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.to)) return { error: 'Неважечка е-пошта.' };
  return bankRun('settings', P, async ({ tx, u, firm }) => {
    const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id)).limit(1);
    await tx.update(firms).set({ settings: { ...((f?.settings ?? {}) as Record<string, unknown>), autoNotify: v } }).where(eq(firms.id, firm.id));
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'autoNotify', entityType: 'firm', entityId: firm.id, data: v });
    return 'Зачувано.';
  });
}

/** Legacy ACT `bkpFix` 12433: link 12x/22x lines to the partner from the statement (missing partners are created). */
export async function bkpFixAction(): Promise<FormState> {
  return bankRun('write', [...P, '/kartici', '/partneri'], async ({ tx, u, firm, year }) => {
    const r = await applyBankPartnerFix(tx, { firmId: firm.id, userId: u.id, year });
    return r.linked ? `Поврзани ${r.linked} ставки со комитентот од изводот${r.created ? `; креирани ${r.created} нови комитенти` : ''}.` : 'Нема такви ставки.';
  });
}

/** Legacy `bulkScan` / `bkDel` 16905–16930 (administrator): delete the ticked statement lines, one confirm. */
export async function bulkDeleteLinesAction(_p: FormState, form: FormData): Promise<FormState> {
  const ids = form.getAll('bl').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return { error: 'Не е избрана ниту една ставка.' };
  return bankRun('del', P, async ({ tx, u, firm }) => {
    if (u.role !== 'admin') throw Object.assign(new Error('Масовното бришење е само за администратор.'), { name: 'BankError' });
    for (const lineId of ids) await deleteLine(tx, { firmId: firm.id, userId: u.id, lineId });
    return `Избришани ${ids.length} ставки.`;
  });
}

/** Legacy ACT `izvFill` 12400: fill empty statement numbers by neighbour (previous + 1). */
export async function izvFillAction(): Promise<FormState> {
  return bankRun('write', P, async ({ tx, u, firm, year }) => `Пополнети ${await fillStatementNumbers(tx, { firmId: firm.id, userId: u.id, year })} броеви на изводи.`);
}

/** Legacy ACT `posFee` 13078: „Книжи провизија 4460“ (amount in denars, date). */
export async function posFeeAction(_p: FormState, form: FormData): Promise<FormState> {
  const amount = num(form.get('amount'));
  const date = str(form.get('date'));
  if (!amount || amount <= 0) return { error: 'Внесете износ на провизијата.' };
  if (!isDate(date)) return { error: 'Внесете датум.' };
  return bankRun('write', [...P, '/fiskPer'], async ({ tx, u, firm, year }) => `Провизијата е книжена (налог ${await bookBankPosFee(tx, { firmId: firm.id, userId: u.id, year, amount: Math.round(amount * 100), date })}).`);
}

export async function removeBankAccountAction(id: string): Promise<FormState> {
  return bankRun('rmBankAcct', [...P, '/bankFmt'], ({ tx, u, firm }) => removeBankAccount(tx, { firmId: firm.id, userId: u.id, id }).then(() => 'Сметката е отстранета.'));
}
