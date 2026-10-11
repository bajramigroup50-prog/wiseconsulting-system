'use server';
/**
 * Server actions of the year-end screens (Завршна сметка). Every action: firm from the session, `requireCan`, the
 * change and its `audit` row in one transaction; postings go through the `@wise/db` year-end service.
 */
import { revalidatePath } from 'next/cache';
import { zmCsvGrid, zmParse, zmSplit } from '@wise/core/yearend/zm-import';
import { prClean } from '@wise/core/yearend/tools';
import type { ZsRule } from '@wise/core/yearend/aop';
import { patchFirmSettings } from '@/lib/firms-office';
import { csvToGrid, DB_F, DE38, DLD_ND, parseTurnoverTb } from '@wise/core';
import {
  audit, clearCrmXml, closeYear, firms, getStatement, importCrmXml, importPostCloseTb, loadYear, lockYear, openNextYear,
  snapshotAop, undoClose, undoOpen, unlockYear, upsertStatement, type StatementPatch,
} from '@wise/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { journalLines, journals, partners, updateJournal } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { canDo } from '@/lib/books';
import { Forbidden } from '@/lib/auth';
import { db } from '@/lib/db';
import { todayMk } from '@/lib/yearend';
import { fmt } from '@/lib/fmt';

const done = (): void => revalidatePath('/', 'layout');
const int = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
};

async function patchStatement(action: string, patch: (cur: Awaited<ReturnType<typeof getStatement>>) => StatementPatch, msg: string): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('write');
    await db().transaction(async (tx) => {
      const cur = await getStatement(tx, firm.id, year);
      const p = patch(cur);
      await upsertStatement(tx, firm.id, year, p, u.id);
      await audit(tx, { userId: u.id, firmId: firm.id, action, entityType: 'annualStatement', entityId: String(year), data: { keys: Object.keys(p) } });
    });
  } catch (e) { return actionError(e); }
  done();
  return { ok: msg };
}

/* ---------------- phase gate (legacy zcAck / zcUnack) ---------------- */

export async function ackFinding(key: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const note = String(form.get('note') ?? '').trim();
  if (!note) return { error: 'Внесете кратко објаснување зошто е во ред.' };
  try {
    // legacy: settings or fix
    const { u, firm, year } = await firmAction('write');
    if (!canDo(u, 'settings', firm.id) && !canDo(u, 'fix', firm.id)) throw new Forbidden('zcAck');
    await db().transaction(async (tx) => {
      const cur = await getStatement(tx, firm.id, year);
      await upsertStatement(tx, firm.id, year, { ack: { ...(cur?.ack ?? {}), [key]: { note, by: u.name, at: new Date().toISOString() } } }, u.id);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'zcAck', entityType: 'annualStatement', entityId: String(year), data: { key, note } });
    });
  } catch (e) { return actionError(e); }
  done();
  return { ok: 'Означено како проверено.' };
}

export async function unackFinding(key: string): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('write');
    if (!canDo(u, 'settings', firm.id) && !canDo(u, 'fix', firm.id)) throw new Forbidden('zcUnack');
    await db().transaction(async (tx) => {
      const cur = await getStatement(tx, firm.id, year);
      const ack = { ...(cur?.ack ?? {}) };
      delete ack[key];
      await upsertStatement(tx, firm.id, year, { ack }, u.id);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'zcUnack', entityType: 'annualStatement', entityId: String(year), data: { key } });
    });
  } catch (e) { return actionError(e); }
  done();
  return {};
}

/* ---------------- close / open / lock ---------------- */

export async function closeYearAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('closeYear');
    const r = await db().transaction((tx) => closeYear(tx, { firmId: firm.id, year, userId: u.id, today: todayMk() }));
    done();
    return { ok: `Годината ${year} е затворена (налог ${r.journal.number}): ${r.plan.profit >= 0 ? 'добивка' : 'загуба'} пред данок ${fmt(r.plan.profit)}, данок ${fmt(r.plan.tax)}, нето ${fmt(r.plan.net)} ден.` };
  } catch (e) { return actionError(e); }
}

/**
 * FIX(P8 #15): legacy `undoClose` deleted `close-Y` with no confirmation and no permission beyond `write`. Now it
 * needs `close` AND `del` (deleting a posted journal), the UI asks for confirmation and the service refuses while
 * the next year's opening exists or the year is locked.
 */
export async function undoCloseAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('close');
    if (!canDo(u, 'del', firm.id)) throw new Forbidden('undoClose');
    await db().transaction((tx) => undoClose(tx, { firmId: firm.id, year, userId: u.id }));
  } catch (e) { return actionError(e); }
  done();
  return { ok: 'Затворањето е поништено.' };
}

/** Legacy `openYear` / `doTransfer` — now behind the phase gate. */
export async function openYearAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('doTransfer');
    const r = await db().transaction((tx) => openNextYear(tx, { firmId: firm.id, year, userId: u.id, today: todayMk() }));
    done();
    return { ok: `Преносот е направен: почетна состојба за ${year + 1} на 01.01.${year + 1} (${r.lines} ставки).` };
  } catch (e) { return actionError(e); }
}

export async function undoOpenAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('close');
    if (!canDo(u, 'del', firm.id)) throw new Forbidden('undoOpen');
    await db().transaction((tx) => undoOpen(tx, { firmId: firm.id, year, userId: u.id }));
  } catch (e) { return actionError(e); }
  done();
  return { ok: 'Почетната состојба е избришана.' };
}

/** Legacy `lockYear` — gated and audited (FIX P8 #15). */
export async function lockYearAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('close');
    await db().transaction((tx) => lockYear(tx, { firmId: firm.id, year, userId: u.id, today: todayMk() }));
  } catch (e) { return actionError(e); }
  done();
  return { ok: 'Годината е заклучена.' };
}

/** Legacy `firmUnlock` (admin only). */
export async function unlockYearAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('close');
    if (u.role !== 'admin') throw new Forbidden('firmUnlock');
    await db().transaction((tx) => unlockYear(tx, { firmId: firm.id, year, userId: u.id }));
  } catch (e) { return actionError(e); }
  done();
  return { ok: 'Годината е отклучена.' };
}

/** Trial balance imported after the close (legacy `obRebuild` path of the opening import). */
export async function importPostCloseTbAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('closeYear');
    const rows = parseTurnoverTb(csvToGrid(String(form.get('text') ?? '')));
    if (!rows.length) return { error: 'Нема редови: залепете колони конто; назив; промет должи; промет побарува; салдо должи; салдо побарува.' };
    const r = await db().transaction((tx) => importPostCloseTb(tx, { firmId: firm.id, year, userId: u.id, rows }));
    if (!r) return { error: 'Бруто билансот не е по затворање (класите 4 и 7 имаат салдо) – увезете го во „Почетна состојба“ → бруто биланс.' };
    done();
    return { ok: `Зачуван е бруто билансот и налогот „Затворање ${year}“: ${r.n} конта · приходи ${fmt(r.rev)} · расходи ${fmt(r.exp)} · добивка пред данок ${fmt(r.profit)}${r.tax ? ' · данок ' + fmt(r.tax) : ''}.` };
  } catch (e) { return actionError(e); }
}

/* ---------------- ДБ / ДБ-ВП / ДЛД-ДБ inputs ---------------- */

export async function saveDb(_prev: ActionState, form: FormData): Promise<ActionState> {
  const A: Record<string, number> = {};
  for (const r of DB_F) {
    if (r[0] === 'h' || r[3] === 'auto') continue;
    const v = int(form.get('db' + r[0]));
    if (v != null) A[r[0]] = v;
  }
  return patchStatement('dbSave', () => ({ dbAdj: A }), 'ДБ е зачуван.');
}

export async function saveVp(_prev: ActionState, form: FormData): Promise<ActionState> {
  const A: Record<string, unknown> = {};
  for (const k of ['01', '07']) { const v = int(form.get('vp' + k)); if (v != null) A[k] = v; }
  for (const k of ['desc', 'nace', 'naceN', 'inv', 'form', 'gdvp']) { const v = String(form.get('vp' + k) ?? '').trim(); if (v) A[k] = v; }
  A.on = form.get('vpon') === 'on';
  return patchStatement('vpSave', () => ({ vpAdj: A }), 'ДБ-ВП е зачуван.');
}

export async function saveDld(_prev: ActionState, form: FormData): Promise<ActionState> {
  const A: Record<string, number> = {};
  for (const [k] of [...DLD_ND, ['red'], ['ak']] as [string][]) { const v = int(form.get('dld' + k)); if (v != null) A[k] = v; }
  // Legacy `tpSave` 10518 also stores the year's tax: next year's monthly advance = tax / 12.
  try {
    const { u, firm, year } = await firmAction('write');
    await db().transaction(async (tx) => {
      await upsertStatement(tx, firm.id, year, { dldAdj: A }, u.id);
      const L = await loadYear(tx, firm.id, year);
      if (L.Y.tp) await upsertStatement(tx, firm.id, year, { dldAdj: { ...A, tax: L.Y.tp.tax } }, u.id);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'tpSave', entityType: 'annualStatement', entityId: String(year), data: { keys: Object.keys(A), tax: L.Y.tp?.tax ?? null } });
    });
  } catch (e) { return actionError(e); }
  done();
  return { ok: 'ДЛД-ДБ е зачуван.' };
}

/* ---------------- manual AOP amounts (legacy zmEdit / zmClear) ---------------- */

export async function saveZsMan(rep: 'bs' | 'bu', _prev: ActionState, form: FormData): Promise<ActionState> {
  return patchStatement('zmSave', (cur) => {
    const M = Object.fromEntries(Object.entries(cur?.zsMan ?? {}).filter(([k]) => !k.startsWith(rep)));
    for (const [k, v] of form.entries()) {
      if (!new RegExp(`^${rep}\\d{3}$`).test(k)) continue;
      const n = int(v);
      if (n != null) M[k] = n;
    }
    return { zsMan: M };
  }, 'Рачните износи се зачувани.');
}

/** Legacy `zmClear`: remove the manual amounts of one statement. */
export async function clearZsMan(rep: 'bs' | 'bu'): Promise<ActionState> {
  return patchStatement('zmClear', (cur) => ({ zsMan: Object.fromEntries(Object.entries(cur?.zsMan ?? {}).filter(([k]) => !k.startsWith(rep))) }), 'Рачните износи се отстранети.');
}

/* ---------------- forms 38 / 35 ---------------- */

export async function saveDe(_prev: ActionState, form: FormData): Promise<ActionState> {
  const M: Record<string, number> = {};
  for (const [n] of DE38) { const v = int(form.get('de' + n)); if (v != null) M[String(n)] = v; }
  return patchStatement('deSave', () => ({ deMan: M }), 'Образецот 38 е зачуван.');
}

export async function resetDe(): Promise<ActionState> {
  return patchStatement('deReset', () => ({ deMan: {} }), 'Сите износи се автоматски.');
}

export async function saveNkdAop(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    const map: Record<string, number> = {};
    for (const [k, v] of form.entries()) {
      if (!k.startsWith('nkd:')) continue;
      const n = int(v);
      if (n == null) continue;
      if (n < 4000 || n > 4654) return { error: 'АОП за образец 35 е од 4000 до 4654.' };
      map[k.slice(4)] = n;
    }
    await db().transaction(async (tx) => {
      const s = (firm.settings ?? {}) as Record<string, unknown>;
      await tx.update(firms).set({ settings: { ...s, nkdAop: { ...((s.nkdAop as Record<string, number>) ?? {}), ...map } } }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'saveFirm', entityType: 'firm', entityId: firm.id, data: { nkdAop: map } });
    });
  } catch (e) { return actionError(e); }
  done();
  return { ok: 'Зачувано.' };
}

/* ---------------- explanatory notes ---------------- */

export async function saveNotes(_prev: ActionState, form: FormData): Promise<ActionState> {
  const auto = new Map<string, string>();
  for (const [k, v] of form.entries()) if (k.startsWith('auto:')) auto.set(k.slice(5), String(v));
  return patchStatement('belSave', (cur) => {
    const N: Record<string, string> = { ...(cur?.notes ?? {}) };
    for (const [k, v] of form.entries()) {
      if (!k.startsWith('bel:')) continue;
      const id = k.slice(4);
      const t = String(v);
      if (t.trim() === (auto.get(id) ?? '').trim() && N[id] == null) continue;
      N[id] = t;
    }
    N._saved = new Date().toISOString();
    return { notes: N };
  }, 'Белешките се зачувани.');
}

export async function resetNote(id: string): Promise<ActionState> {
  return patchStatement('belReset', (cur) => {
    const N = { ...(cur?.notes ?? {}) };
    delete N[id];
    return { notes: N };
  }, 'Вратен е автоматскиот текст.');
}

/* ---------------- ЦРСМ XML ---------------- */

export async function importCrmXmlAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('write');
    const f = form.get('file');
    if (!(f instanceof File) || !f.size) return { error: 'Изберете XML датотека.' };
    if (f.size > 5_000_000) return { error: 'Датотеката е преголема.' };
    const xml = await f.text();
    let r: { year: number; aop: number };
    try {
      r = await db().transaction((tx) => importCrmXml(tx, { firmId: firm.id, userId: u.id, xml, year }));
    } catch (e) {
      if (e instanceof Error && !(e as { code?: string }).code && /годишна сметка|XML|АОП/.test(e.message)) return { error: 'XML-от не може да се прочита: ' + e.message };
      throw e;
    }
    done();
    return { ok: `Увезени се ${r.aop} АОП износи за ${r.year} како рачни износи.` };
  } catch (e) { return actionError(e); }
}

export async function clearCrmXmlAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('write');
    await db().transaction((tx) => clearCrmXml(tx, { firmId: firm.id, userId: u.id, year }));
  } catch (e) { return actionError(e); }
  done();
  return { ok: 'Увезените износи се отстранети; рачно внесените се вратени.' };
}

/** Submission status of the annual account (draft → ready → submitted → accepted) with an AOP snapshot. */
export async function setStatementStatus(status: 'draft' | 'ready' | 'submitted' | 'accepted'): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('write');
    await db().transaction(async (tx) => {
      const L = await loadYear(tx, firm.id, year);
      await snapshotAop(tx, L, u.id, { status, ...(status === 'submitted' ? { submittedAt: new Date(), submittedBy: u.id } : {}) });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'zsStatus', entityType: 'annualStatement', entityId: String(year), data: { status } });
    });
  } catch (e) { return actionError(e); }
  done();
  return { ok: 'Статусот е променет.' };
}

/* ---------------- import of a filed annual account (legacy zmImport 10953) ---------------- */

/** Excel (all sheets, first column = sheet name) or CSV text → manual AOP amounts for Y (current) and Y−1 (previous). */
export async function importZsAopAction(input: { csv?: string; grid?: unknown[][] }): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('write');
    const grid = typeof input?.csv === 'string' ? zmCsvGrid(input.csv.slice(0, 5_000_000)) : Array.isArray(input?.grid) ? input.grid.slice(0, 20000).filter(Array.isArray) as unknown[][] : [];
    const rows = zmParse(grid);
    if (!rows.length) return { error: 'Не се најдени АОП редови.' };
    const { cur, prev } = zmSplit(rows);
    const L = await db().transaction(async (tx) => {
      const merge = async (y: number, M: Record<string, number>) => {
        if (!Object.keys(M).length) return;
        const s = await getStatement(tx, firm.id, y);
        await upsertStatement(tx, firm.id, y, { zsMan: { ...(s?.zsMan ?? {}), ...M } }, u.id);
      };
      await merge(year, cur);
      await merge(year - 1, prev);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'zmImport', entityType: 'annualStatement', entityId: String(year), data: { cur: Object.keys(cur).length, prev: Object.keys(prev).length } });
      return loadYear(tx, firm.id, year);
    });
    done();
    const V = L.Y.co.zs.V;
    const ok = Math.abs((V.bs063 || 0) - (V.bs111 || 0)) < 1;
    return { ok: `✓ Увезени ${Object.keys(cur).length} износи за ${year}${Object.keys(prev).length ? ' и ' + Object.keys(prev).length + ' за ' + (year - 1) : ''}. Актива ${fmt(V.bs063 || 0)} / Пасива ${fmt(V.bs111 || 0)} ${ok ? '✓' : '✕ не се совпаѓаат – проверете'}.` };
  } catch (e) { return actionError(e); }
}

/* ---------------- AOP rules (legacy zprSave / prReset, ACT_NEED settings) ---------------- */

export async function saveZsRulesAction(rows: Partial<ZsRule>[]): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('settings');
    const R = prClean(Array.isArray(rows) ? rows.slice(0, 2000) : []);
    if (!R.length) return { error: 'Нема правила за зачувување.' };
    await db().transaction(async (tx) => {
      await patchFirmSettings(tx, firm.id, { zsRules: R });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'zprSave', entityType: 'firm', entityId: firm.id, data: { rules: R.length } });
    });
    done();
    return { ok: `Зачувани ${R.length} правила.` };
  } catch (e) { return actionError(e); }
}

export async function resetZsRulesAction(): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('settings');
    await db().transaction(async (tx) => {
      await patchFirmSettings(tx, firm.id, { zsRules: [] });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'prReset', entityType: 'firm', entityId: firm.id });
    });
    done();
    return { ok: 'Вратени се стандардните правила.' };
  } catch (e) { return actionError(e); }
}

/* ---------------- form 35 base: activity code per revenue account (legacy spSave 7722) ---------------- */

export async function saveActMap(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    const map: Record<string, string> = { ...(((firm.settings ?? {}) as { actMap?: Record<string, string> }).actMap ?? {}) };
    for (const [k, v] of form.entries()) {
      if (!k.startsWith('act:')) continue;
      const acc = k.slice(4), val = String(v).trim().slice(0, 20);
      if (!/^7[4-9]\w*$/.test(acc)) continue;
      if (val) map[acc] = val; else delete map[acc];
    }
    await db().transaction(async (tx) => {
      await tx.update(firms).set({ settings: sql`(${firms.settings} - 'actMap') || ${JSON.stringify({ actMap: map })}::jsonb` }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'spSave', entityType: 'firm', entityId: firm.id, data: { n: Object.keys(map).length } });
    });
    done();
    return { ok: 'Шифрите на дејност се зачувани.' };
  } catch (e) { return actionError(e); }
}

/* ---------------- zsProc cards 5 / 6 / 8 (legacy zpArch 11118, crmPeriod 11190) ---------------- */

/**
 * Legacy `zpArchive`: keep the notes' amounts of year `y` (`belSnap[y]`, AOP → rounded amount) so they become next
 * year's „претходна година“, and mark the archive (`zsArch[y]`). Stored in the firm settings (no schema change);
 * the notes PDF itself goes to the dossier through „7. Досие“ → „💾 Зачувај ги датотеките“.
 */
export async function archiveNotesAction(y: number): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return { error: 'Неважечка година.' };
    const n = await db().transaction(async (tx) => {
      const L = await loadYear(tx, firm.id, y);
      const snap: Record<string, number> = {};
      for (const [k, v] of Object.entries(L.Y.co.zs.V)) if (/^b[su]\d{3}$/.test(k) && Math.round(v || 0)) snap[k] = Math.round(v);
      const s = (firm.settings ?? {}) as { belSnap?: Record<string, unknown>; zsArch?: Record<string, unknown> };
      await patchFirmSettings(tx, firm.id, {
        belSnap: { ...(s.belSnap ?? {}), [y]: snap },
        zsArch: { ...(s.zsArch ?? {}), [y]: { at: new Date().toISOString(), by: u.name, n: Object.keys(snap).length } },
      });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'zpArch', entityType: 'annualStatement', entityId: String(y), data: { n: Object.keys(snap).length } });
      return Object.keys(snap).length;
    });
    done();
    return { ok: `Белешките за ${y} се зачувани (${n} износи) – тие се „претходна година“ во ${y + 1}. PDF-от во досието: „7. Досие“ → „💾 Зачувај ги датотеките“.` };
  } catch (e) { return actionError(e); }
}

/** Legacy card 6 „Period (ЦРМ, 0–4)“. */
export async function setCrmPeriodAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = Math.trunc(Number(form.get('crmPeriod')));
  if (!(p >= 0 && p <= 4)) return { error: 'Period е 0–4.' };
  return patchStatement('crmPeriod', () => ({ crmPeriod: p }), `Period за ЦРМ: ${p}.`);
}

/* ---------------- npDist: distribute a 12../22.. balance without partner (legacy 17047–17090, ACT_NEED fix) ---------------- */

export async function npDistAction(lineId: number, rows: { n: string; a: string }[]): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('npSave');
    if (!(await requireFix(u, firm.id))) return { error: 'Немате дозвола за корекција на налози.' };
    const num = (s: string) => { const v = Number(String(s ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0; };
    const R = (Array.isArray(rows) ? rows : []).map((r) => ({ n: String(r.n ?? '').trim().slice(0, 200), a: num(r.a) })).filter((r) => r.n && r.a).slice(0, 500);
    if (!R.length) return { error: 'Внесете барем еден партнер со износ.' };
    const msg = await db().transaction(async (tx) => {
      const [ln] = await tx.select().from(journalLines).where(and(eq(journalLines.id, lineId), eq(journalLines.firmId, firm.id))).limit(1);
      if (!ln || ln.partnerId) throw new UserErr('Налогот е променет – отворете повторно.');
      const side: 'd' | 'p' = Number(ln.debit) ? 'd' : 'p';
      const amt = Math.round((Number(ln.debit) || Number(ln.credit)) * 100) / 100;
      const dist = Math.round(R.reduce((s, r) => s + r.a, 0) * 100) / 100;
      if (dist - amt > 0.009) throw new UserErr(`Распределено (${fmt(dist)}) е повеќе од салдото (${fmt(amt)}).`);
      const [j] = await tx.select().from(journals).where(eq(journals.id, ln.journalId)).limit(1);
      if (!j) throw new UserErr('Налогот не е пронајден.');
      const P = await tx.select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firm.id));
      const pid = async (n: string) => {
        const ex = P.find((p) => p.name.trim().toLowerCase() === n.toLowerCase());
        if (ex) return ex.id;
        const [ins] = await tx.insert(partners).values({ firmId: firm.id, name: n, active: true }).returning({ id: partners.id });
        P.push({ id: ins!.id, name: n });
        return ins!.id;
      };
      const L = await tx.select().from(journalLines).where(eq(journalLines.journalId, j.id)).orderBy(asc(journalLines.lineNo));
      const keep = (l: typeof L[number]) => ({ account: l.account, debit: l.debit, credit: l.credit, partnerId: l.partnerId, note: l.note, doc: l.doc, currency: l.currency, amountCur: l.amountCur, locationId: l.locationId });
      const out = [];
      for (const l of L) {
        if (l.id !== ln.id) { out.push(keep(l)); continue; }
        for (const r of R) out.push({ ...keep(l), partnerId: await pid(r.n), debit: side === 'd' ? r.a : 0, credit: side === 'p' ? r.a : 0, currency: null, amountCur: null });
        const rest = Math.round((amt - dist) * 100) / 100;
        if (Math.abs(rest) >= 0.01) out.push({ ...keep(l), debit: side === 'd' ? rest : 0, credit: side === 'p' ? rest : 0, currency: null, amountCur: null });
      }
      await updateJournal(tx, j.id, {
        firmId: firm.id, date: j.date, kind: j.kind as Parameters<typeof updateJournal>[2]['kind'], description: j.description, sourceType: j.sourceType, sourceId: j.sourceId,
        number: j.number, periodFrom: j.periodFrom, periodTo: j.periodTo, meta: j.meta, lines: out, userId: u.id, requirePartner: false, auditAction: 'npSave',
      });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'npSave', entityType: 'journal', entityId: j.id, data: { text: `Распределба по партнери: конто ${ln.account} (${R.length} партнери, ${fmt(dist)})` } });
      const rest = Math.round((amt - dist) * 100) / 100;
      return `Распределено ${fmt(dist)} на ${R.length} партнери${Math.abs(rest) >= 0.01 ? '; остаток без партнер ' + fmt(rest) : ''}.`;
    });
    done();
    return { ok: msg };
  } catch (e) {
    if (e instanceof UserErr) return { error: e.message };
    return actionError(e);
  }
}

class UserErr extends Error {}
const requireFix = async (u: Awaited<ReturnType<typeof firmAction>>['u'], firmId: string) => canDo(u, 'fix', firmId);
