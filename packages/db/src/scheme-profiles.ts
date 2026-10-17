/**
 * Numbered posting schemes „Шема 1, 2, 3 …“ per firm (`firms.settings.schemeProfiles`, rules in
 * `@wise/core/scheme-profiles`): save / delete / copy to other firms, and the bulk „Прекнижи ги избраните со Шема N“
 * of a nalog (open periods only, audited, with the konto totals before → after).
 *
 * Every write runs in the caller's transaction with its audit row. Kontos are checked against the target firm's chart
 * (`missingAccounts`); VAT kontos also with the VAT rules (no summary konto, `validateSchemeProfile`).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { repostDiffs, type KontoDiff, type KontoTotals } from '@wise/core/repost';
import {
  nextSchemeNo, schemeNoOf, schemeProfileKontos, schemeProfilesOf, validateSchemeProfile, MAX_SCHEME_NO, SCHEME_PROFILE_KEYS, type SchemeProfile,
} from '@wise/core/scheme-profiles';
import type { VatAccountMap } from '@wise/core';
import { audit, type Tx } from './audit';
import { missingAccounts, PostingError } from './posting';
import { firms, invoices, journalLines, journals, partners, purchases, type Firm } from './schema/index';
import { repostInvoice } from './sales/invoices';
import { repostPurchase } from './sales/purchases';

export class SchemeProfileError extends PostingError {
  constructor(message: string) { super('bad_account', message); this.name = 'SchemeProfileError'; }
}

export interface SchemeProfileInput {
  /** Existing number to update; missing / 0 = a new scheme with the next free number. */
  no?: number | null;
  name: string;
  sch?: Record<string, string>;
  vatOut?: VatAccountMap | null; vatIn?: VatAccountMap | null; vatImp?: VatAccountMap | null;
}

const settingsOf = (f: Pick<Firm, 'settings'>) => (f.settings ?? {}) as Record<string, unknown>;
const clean = (m: Record<string, unknown> | null | undefined, keys?: readonly string[]) =>
  Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([k, v]) => !!v && (!keys || keys.includes(k!)))) as Record<string, string>;

async function firmForUpdate(tx: Tx, firmId: string): Promise<Firm> {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).for('update').limit(1);
  if (!f) throw new SchemeProfileError('Фирмата не постои.');
  return f;
}

/** Validation errors of a scheme for a firm (shape + VAT rules + the firm's chart). Empty = OK. */
export async function schemeProfileErrors(tx: Tx, firmId: string, p: SchemeProfileInput): Promise<string[]> {
  const errs = validateSchemeProfile(p);
  if (errs.length) return errs;
  const missing = await missingAccounts(tx, firmId, schemeProfileKontos({ ...p, no: 2 }));
  return missing.length ? [`Контото ${missing.join(', ')} не постои во контниот план.`] : [];
}

async function putProfiles(tx: Tx, f: Firm, list: SchemeProfile[]): Promise<void> {
  await tx.update(firms).set({ settings: { ...settingsOf(f), schemeProfiles: list.sort((a, b) => a.no - b.no) } }).where(eq(firms.id, f.id));
}

/** Save (create or update) a numbered scheme of the firm. Returns it. */
export async function saveSchemeProfile(tx: Tx, firmId: string, input: SchemeProfileInput, by: { userId: string | null; name?: string }): Promise<SchemeProfile> {
  const f = await firmForUpdate(tx, firmId);
  const list = schemeProfilesOf(f.settings);
  const p: SchemeProfileInput = {
    ...input, name: String(input.name ?? '').trim().slice(0, 60), sch: clean(input.sch, SCHEME_PROFILE_KEYS),
    vatOut: clean(input.vatOut as Record<string, unknown>), vatIn: clean(input.vatIn as Record<string, unknown>), vatImp: clean(input.vatImp as Record<string, unknown>),
  };
  const errs = await schemeProfileErrors(tx, firmId, p);
  if (errs.length) throw new SchemeProfileError(errs.join(' · '));
  let no = input.no ? schemeNoOf(input.no) : 0;
  if (input.no && (no < 2 || !list.some((x) => x.no === no))) throw new SchemeProfileError(`Шема ${input.no} не постои.`);
  if (!no) no = nextSchemeNo(list);
  if (no > MAX_SCHEME_NO) throw new SchemeProfileError(`Најмногу ${MAX_SCHEME_NO} шеми.`);
  const prof: SchemeProfile = { no, name: p.name, sch: p.sch, vatOut: p.vatOut, vatIn: p.vatIn, vatImp: p.vatImp, updated: new Date().toISOString(), ...(by.name ? { by: by.name } : {}) };
  const old = list.find((x) => x.no === no);
  await putProfiles(tx, f, [...list.filter((x) => x.no !== no), prof]);
  await audit(tx, { userId: by.userId, firmId, action: 'schProfileSave', entityType: 'firm', entityId: firmId,
    data: { no, name: prof.name, created: !old, sch: prof.sch, vatOut: prof.vatOut, vatIn: prof.vatIn, vatImp: prof.vatImp, text: `Шема ${no} – ${prof.name}${old ? ' (измена)' : ' (нова)'}` } });
  return prof;
}

/** Documents and partners that use a scheme number of the firm. */
export async function schemeProfileUse(tx: Tx, firmId: string, no: number): Promise<{ invoices: number; purchases: number; partners: number }> {
  const v = String(no);
  const [[i], [p], [c]] = await Promise.all([
    tx.select({ n: sql<number>`count(*)::int` }).from(invoices).where(and(eq(invoices.firmId, firmId), sql`${invoices.data}->>'scheme' = ${v}`)),
    tx.select({ n: sql<number>`count(*)::int` }).from(purchases).where(and(eq(purchases.firmId, firmId), sql`${purchases.data}->>'scheme' = ${v}`)),
    tx.select({ n: sql<number>`count(*)::int` }).from(partners).where(and(eq(partners.firmId, firmId), sql`${partners.data}->>'scheme' = ${v}`)),
  ]);
  return { invoices: i?.n ?? 0, purchases: p?.n ?? 0, partners: c?.n ?? 0 };
}

/** Delete a numbered scheme — refused while documents or partner cards use it (their posting would change). */
export async function deleteSchemeProfile(tx: Tx, firmId: string, no: number, userId: string | null): Promise<string> {
  const f = await firmForUpdate(tx, firmId);
  const list = schemeProfilesOf(f.settings);
  const p = list.find((x) => x.no === no);
  if (!p) throw new SchemeProfileError(`Шема ${no} не постои.`);
  const u = await schemeProfileUse(tx, firmId, no);
  if (u.invoices || u.purchases || u.partners) {
    throw new SchemeProfileError(`Шема ${no} се користи (${[u.invoices && `${u.invoices} излезни`, u.purchases && `${u.purchases} влезни`, u.partners && `${u.partners} комитенти`].filter(Boolean).join(', ')}) – прво прекнижете ги документите со друга шема и сменете ја шемата кај комитентите.`);
  }
  await putProfiles(tx, f, list.filter((x) => x.no !== no));
  await audit(tx, { userId, firmId, action: 'schProfileDel', entityType: 'firm', entityId: firmId, data: { no, name: p.name, text: `Избришана Шема ${no} – ${p.name}` } });
  return p.name;
}

export interface SchemeCopyResult { copied: { firmId: string; firm: string; no: number }[]; skipped: { firmId: string; firm: string; reason: string }[] }

/**
 * Copy one numbered scheme to other firms: the same name in the target is replaced, otherwise it gets the same number
 * when free, else the next free one. A target whose chart lacks a konto is skipped (reported).
 */
export async function copySchemeProfile(tx: Tx, fromFirmId: string, no: number, targetFirmIds: readonly string[], by: { userId: string | null; name?: string }): Promise<SchemeCopyResult> {
  const [src] = await tx.select().from(firms).where(eq(firms.id, fromFirmId)).limit(1);
  const p = src ? schemeProfilesOf(src.settings).find((x) => x.no === no) : undefined;
  if (!src || !p) throw new SchemeProfileError(`Шема ${no} не постои.`);
  const R: SchemeCopyResult = { copied: [], skipped: [] };
  for (const id of [...new Set(targetFirmIds)].filter((x) => x !== fromFirmId)) {
    const f = await firmForUpdate(tx, id).catch(() => null);
    if (!f) continue;
    const errs = await schemeProfileErrors(tx, id, p);
    if (errs.length) { R.skipped.push({ firmId: id, firm: f.name, reason: errs.join(' · ') }); continue; }
    const list = schemeProfilesOf(f.settings);
    const same = list.find((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    const tn = same?.no ?? (list.some((x) => x.no === no) ? nextSchemeNo(list) : no);
    if (tn > MAX_SCHEME_NO) { R.skipped.push({ firmId: id, firm: f.name, reason: `најмногу ${MAX_SCHEME_NO} шеми` }); continue; }
    const prof: SchemeProfile = { ...p, no: tn, updated: new Date().toISOString(), ...(by.name ? { by: by.name } : {}) };
    await putProfiles(tx, f, [...list.filter((x) => x.no !== tn), prof]);
    await audit(tx, { userId: by.userId, firmId: id, action: 'schProfileCopy', entityType: 'firm', entityId: id,
      data: { no: tn, name: p.name, fromFirmId, fromNo: no, replaced: !!same, text: `Шема ${tn} – ${p.name} (копирана од ${src.name})` } });
    R.copied.push({ firmId: id, firm: f.name, no: tn });
  }
  return R;
}

/* ---------------- „Прекнижи ги избраните со Шема N“ ---------------- */

export interface SchemeRepostResult {
  n: number;
  skipped: { journalId: string; label: string; reason: string }[];
  /** Konto totals of the selected journals before → after (only the changed kontos). */
  diffs: KontoDiff[];
}

const REPOSTABLE = ['invoice', 'purchase'] as const;
const lockMsg = (e: unknown) => e instanceof PostingError && (e.code === 'locked' || e.code === 'vat_closed');

async function kontoTotals(tx: Tx, ids: readonly string[]): Promise<Map<string, KontoTotals>> {
  const M = new Map<string, KontoTotals>();
  if (!ids.length) return M;
  const rows = await tx.select({ a: journalLines.account, d: sql<string>`sum(${journalLines.debit})`, c: sql<string>`sum(${journalLines.credit})` })
    .from(journalLines).where(inArray(journalLines.journalId, [...ids])).groupBy(journalLines.account);
  for (const r of rows) M.set(r.a, { d: Math.round(Number(r.d) * 100), c: Math.round(Number(r.c) * 100) });
  return M;
}

/**
 * Re-post the chosen document journals of the firm with „Шема N“ (the document keeps the choice, `data.scheme`).
 * OPEN periods only: a locked journal, the firm's locked period or a closed VAT period is skipped and reported; each
 * document runs in its own savepoint (a failure leaves it as it was). Journals that are not invoices / purchases are
 * skipped. Audited `schemeRepost` with the konto totals before → after.
 */
export async function repostWithScheme(tx: Tx, firmId: string, journalIds: readonly string[], no: number, userId: string | null): Promise<SchemeRepostResult> {
  const f = await firmForUpdate(tx, firmId);
  const n = schemeNoOf(no);
  if (n > 1 && !schemeProfilesOf(f.settings).some((x) => x.no === n)) throw new SchemeProfileError(`Шема ${no} не постои.`);
  const ids = [...new Set(journalIds)].filter(Boolean);
  const J = ids.length ? await tx.select().from(journals).where(and(eq(journals.firmId, firmId), inArray(journals.id, ids))) : [];
  const R: SchemeRepostResult = { n: 0, skipped: [], diffs: [] };
  const label = (j: (typeof J)[number]) => j.description || j.number;
  const todo: typeof J = [];
  for (const j of J) {
    if (!j.sourceId || !(REPOSTABLE as readonly string[]).includes(j.sourceType ?? '')) R.skipped.push({ journalId: j.id, label: label(j), reason: 'не е фактура / влезна фактура' });
    else if (j.locked) R.skipped.push({ journalId: j.id, label: label(j), reason: 'налогот е заклучен' });
    else if (f.lockDate && j.date <= f.lockDate) R.skipped.push({ journalId: j.id, label: label(j), reason: `заклучен период (до ${f.lockDate.split('-').reverse().join('.')})` });
    else todo.push(j);
  }
  const before = await kontoTotals(tx, todo.map((j) => j.id));
  const done: string[] = [];
  for (const j of todo) {
    try {
      await tx.transaction(async (sp0) => {
        const sp = sp0 as unknown as Tx;
        const id = j.sourceId!;
        if (j.sourceType === 'invoice') {
          const [d] = await sp.select({ data: invoices.data }).from(invoices).where(and(eq(invoices.id, id), eq(invoices.firmId, firmId))).limit(1);
          if (!d) throw new SchemeProfileError('документот не постои');
          await sp.update(invoices).set({ data: { ...(d.data ?? {}), scheme: n } }).where(eq(invoices.id, id));
          await repostInvoice(sp, f, id, userId);
        } else {
          const [d] = await sp.select({ data: purchases.data }).from(purchases).where(and(eq(purchases.id, id), eq(purchases.firmId, firmId))).limit(1);
          if (!d) throw new SchemeProfileError('документот не постои');
          await sp.update(purchases).set({ data: { ...(d.data ?? {}), scheme: n } }).where(eq(purchases.id, id));
          await repostPurchase(sp, f, id, userId);
        }
      });
      R.n++; done.push(j.id);
    } catch (e) {
      R.skipped.push({ journalId: j.id, label: label(j), reason: lockMsg(e) ? 'заклучен / затворен ДДВ период' : e instanceof Error ? e.message : String(e) });
    }
  }
  // the journals keep their ids on re-posting; a failed one is unchanged — so the totals compare like for like
  R.diffs = repostDiffs(before, await kontoTotals(tx, todo.map((j) => j.id)));
  await audit(tx, { userId, firmId, action: 'schemeRepost', entityType: 'journal', data: {
    scheme: n, n: R.n, skipped: R.skipped.length, journals: done, diffs: R.diffs.slice(0, 50),
    text: `Прекнижани ${R.n} документи со Шема ${n}${R.skipped.length ? ` · ${R.skipped.length} прескокнати` : ''}`,
  } });
  return R;
}
