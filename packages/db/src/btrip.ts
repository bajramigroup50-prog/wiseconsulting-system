/**
 * ✈️ Службени патувања — патни налози of a firm (stored in `firm_docs`, type `btrip`, no own table) and the office
 * codebook (`app_settings` `btrip`: domestic per diem, per-country amounts, own-car %, fuel price; a firm may override
 * the domestic amount / car % in `btrip:<firmId>`). Posting of the settlement replaces the journal of the same order
 * (source `btrip` + order id). Every write is audited in the same transaction.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { btEntries, btNextNo, btSettings, btSettle, type BtSchemeKey, type BtSettings, type BtSettlement, type BusinessTrip } from '@wise/core/btrip';
import { schemeValue } from '@wise/core/posting';
import { audit, type Tx } from './audit';
import { postJournal, unpostSource } from './posting';
import { loadVatPostingContext } from './vat-context';
import { appSettings, employees, firmDocs, firms, journals } from './schema/index';

export const BTRIP_DOC = 'btrip';
export const BTRIP_SOURCE = 'btrip';
export const BTRIP_SETTINGS_KEY = 'btrip';
export const btripFirmKey = (firmId: string) => `btrip:${firmId}`;

export class BtripError extends Error {}
const fail = (m: string): never => { throw new BtripError(m); };

export interface BtripRow { id: string; number: string; date: string; status: string; data: BusinessTrip }
type Q = Pick<Tx, 'select'>;

export async function listBtrips(tx: Q, firmId: string): Promise<BtripRow[]> {
  const R = await tx.select().from(firmDocs).where(and(eq(firmDocs.firmId, firmId), eq(firmDocs.type, BTRIP_DOC)));
  return R.map((r) => ({ id: r.id, number: r.number ?? '', date: r.date ?? '', status: r.status, data: r.data as unknown as BusinessTrip }))
    .sort((a, b) => (a.date === b.date ? (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0) : a.date < b.date ? -1 : 1));
}

export async function getBtrip(tx: Q, firmId: string, id: string): Promise<BtripRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await tx.select().from(firmDocs).where(and(eq(firmDocs.id, id), eq(firmDocs.firmId, firmId), eq(firmDocs.type, BTRIP_DOC))).limit(1);
  return r ? { id: r.id, number: r.number ?? '', date: r.date ?? '', status: r.status, data: r.data as unknown as BusinessTrip } : null;
}

/** Office codebook + firm override. */
export async function btripSettings(tx: Q, firmId: string): Promise<{ s: BtSettings; office: Partial<BtSettings>; firm: Partial<BtSettings> }> {
  const R = await tx.select().from(appSettings).where(inArray(appSettings.key, [BTRIP_SETTINGS_KEY, btripFirmKey(firmId)]));
  const office = (R.find((r) => r.key === BTRIP_SETTINGS_KEY)?.value ?? {}) as Partial<BtSettings>;
  const firm = (R.find((r) => r.key === btripFirmKey(firmId))?.value ?? {}) as Partial<BtSettings>;
  return { s: btSettings(office, firm), office, firm };
}

export async function saveBtripSettings(tx: Tx, userId: string, key: string, value: Partial<BtSettings>): Promise<void> {
  const v = value as Record<string, unknown>;
  await tx.insert(appSettings).values({ key, value: v, updatedBy: userId }).onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedBy: userId } });
  await audit(tx, { userId, action: 'btCfgSave', entityType: 'app_settings', entityId: key, data: { domAmt: value.domAmt, carPct: value.carPct, fuelPrice: value.fuelPrice, rates: Object.keys(value.rates ?? {}).length } });
}

export interface BtActor { firmId: string; userId: string }

export async function saveBtrip(tx: Tx, a: BtActor, id: string | null, t: BusinessTrip): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) fail('Внесете датум на налогот.');
  if (!t.employeeId) fail('Изберете вработен.');
  const [e] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, t.employeeId), eq(employees.firmId, a.firmId))).limit(1);
  if (!e) fail('Вработениот не постои.');
  if (!t.dep || !t.ret || !Number.isFinite(Date.parse(t.dep)) || !Number.isFinite(Date.parse(t.ret))) fail('Внесете поаѓање и враќање (датум и час).');
  if (Date.parse(t.ret) < Date.parse(t.dep)) fail('Враќањето е пред поаѓањето.');
  if (t.abroad && !t.country && !(t.segs ?? []).some((g) => g.c)) fail('Изберете држава.');
  for (const g of t.segs ?? []) if (g.c && g.in && g.out && Date.parse(g.out) < Date.parse(g.in)) fail('Кај државите излезот е пред влезот.');
  const all = await listBtrips(tx, a.firmId);
  let number = t.number.trim();
  if (!number) number = btNextNo(all, t.date);
  if (all.some((x) => x.id !== id && x.number === number)) fail(`Налог бр. ${number} веќе постои.`);
  const data = { ...t, number } as unknown as Record<string, unknown>;
  const status = t.status ?? 'open';
  let out = id ?? '';
  if (id) {
    const old = all.find((x) => x.id === id) ?? fail('Налогот не постои.');
    if (old.status === 'done' && await btripJournal(tx, a.firmId, id)) fail('Налогот е книжен – прво откнижете го за да го менувате.');
    await tx.update(firmDocs).set({ number, date: t.date, status, data }).where(and(eq(firmDocs.id, id), eq(firmDocs.firmId, a.firmId), eq(firmDocs.type, BTRIP_DOC)));
  } else out = (await tx.insert(firmDocs).values({ firmId: a.firmId, type: BTRIP_DOC, number, date: t.date, status, data, createdBy: a.userId }).returning({ id: firmDocs.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'btSave', entityType: 'firm_doc', entityId: out, data: { number, employeeId: t.employeeId, abroad: t.abroad } });
  return out;
}

export async function deleteBtrip(tx: Tx, a: BtActor, id: string): Promise<void> {
  await unpostSource(tx, { firmId: a.firmId, sourceType: BTRIP_SOURCE, sourceId: id, userId: a.userId });
  await tx.delete(firmDocs).where(and(eq(firmDocs.id, id), eq(firmDocs.firmId, a.firmId), eq(firmDocs.type, BTRIP_DOC)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'btDel', entityType: 'firm_doc', entityId: id });
}

export async function btripJournal(tx: Q, firmId: string, id: string): Promise<string | null> {
  const [j] = await tx.select({ number: journals.number }).from(journals).where(and(eq(journals.firmId, firmId), eq(journals.sourceType, BTRIP_SOURCE), eq(journals.sourceId, id))).limit(1);
  return j ? j.number ?? '✓' : null;
}
/** Journal numbers of the firm's posted orders (order id → nalog number). */
export async function btripJournals(tx: Q, firmId: string): Promise<Map<string, string>> {
  const R = await tx.select({ s: journals.sourceId, n: journals.number }).from(journals).where(and(eq(journals.firmId, firmId), eq(journals.sourceType, BTRIP_SOURCE)));
  return new Map(R.filter((r) => r.s).map((r) => [r.s!, r.n ?? '✓']));
}

/**
 * Book the settlement (dated on the return) through the firm's posting scheme and mark the order `done`.
 * `fx` = NBRM lookup (MKD per unit). Re-posting replaces the same journal.
 */
export async function postBtrip(tx: Tx, a: BtActor, id: string, fx: (cur: string, d: string) => number): Promise<{ number: string; st: BtSettlement }> {
  const r = await getBtrip(tx, a.firmId, id) ?? fail('Налогот не постои.');
  if (r.status === 'cancel') fail('Налогот е откажан.');
  const { s } = await btripSettings(tx, a.firmId);
  const st = btSettle(r.data, s, fx);
  if (st.miss.length) fail(`Нема курс на НБРМ за: ${st.miss.join(', ')}.`);
  if (!(st.total > 0)) fail('Нема износ за книжење (дневници или трошоци).');
  const [f] = await tx.select().from(firms).where(eq(firms.id, a.firmId)).limit(1);
  const ctx = await loadVatPostingContext(tx, f!);
  const [e] = await tx.select({ name: employees.name }).from(employees).where(eq(employees.id, r.data.employeeId)).limit(1);
  const who = e?.name ?? '';
  const lines = btEntries(r.data, st, (k: BtSchemeKey) => schemeValue(ctx, k), who);
  const date = (r.data.ret || r.data.date).slice(0, 10);
  const j = await postJournal(tx, {
    firmId: a.firmId, date, kind: 'btrip', sourceType: BTRIP_SOURCE, sourceId: id, userId: a.userId,
    description: `Патен налог ${r.number} – ${who} – ${r.data.dest || ''}`.trim(), lines,
  });
  await tx.update(firmDocs).set({ status: 'done', data: { ...r.data, status: 'done' } as unknown as Record<string, unknown> }).where(eq(firmDocs.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'btPost', entityType: 'firm_doc', entityId: id, data: { nalog: j.number, total: st.total, toPay: st.toPay } });
  return { number: j.number ?? '', st };
}

export async function unpostBtrip(tx: Tx, a: BtActor, id: string): Promise<void> {
  const r = await getBtrip(tx, a.firmId, id) ?? fail('Налогот не постои.');
  await unpostSource(tx, { firmId: a.firmId, sourceType: BTRIP_SOURCE, sourceId: id, userId: a.userId });
  await tx.update(firmDocs).set({ status: 'open', data: { ...r.data, status: 'open' } as unknown as Record<string, unknown> }).where(eq(firmDocs.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'btUnpost', entityType: 'firm_doc', entityId: id });
}
