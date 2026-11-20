/**
 * 📆 Временски разграничувања — db side of `@wise/core/deferrals`. The schedules are kept in `firms.settings.deferrals`
 * (a handful per firm); every booked month is its own journal (source `deferral` / `<id>:<YYYY-MM>`, kind `manual`),
 * so the period lock, the chart check and the audit of `postJournal` apply, and a month can be undone on its own.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import {
  DEFERRAL_SOURCE, deferralError, deferralLines, deferralSourceId, deferralState, type Deferral, type DeferralState,
} from '@wise/core/deferrals';
import { audit, type Tx } from './audit';
import { PostingError, postJournal, unpostSource } from './posting';
import { firms, journals } from './schema/index';

const listOf = (settings: unknown): Deferral[] => {
  const v = ((settings ?? {}) as { deferrals?: unknown }).deferrals;
  return Array.isArray(v) ? (v as Deferral[]) : [];
};

async function lockFirm(tx: Tx, firmId: string) {
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).for('update').limit(1);
  if (!f) throw new PostingError('firm_not_found', 'Фирмата не постои.');
  return f;
}

async function saveList(tx: Tx, firmId: string, settings: unknown, list: Deferral[]) {
  await tx.update(firms).set({ settings: { ...((settings ?? {}) as Record<string, unknown>), deferrals: list } }).where(eq(firms.id, firmId));
}

/** Source ids of the booked months of the firm's schedules. */
async function postedIds(tx: Tx, firmId: string): Promise<Set<string>> {
  const R = await tx.select({ s: journals.sourceId }).from(journals)
    .where(and(eq(journals.firmId, firmId), eq(journals.sourceType, DEFERRAL_SOURCE)));
  return new Set(R.map((r) => r.s!).filter(Boolean));
}

export async function deferralStates(tx: Tx, firmId: string, uptoYm: string): Promise<DeferralState[]> {
  const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firmId)).limit(1);
  const P = await postedIds(tx, firmId);
  return listOf(f?.settings).map((d) => deferralState(d, P, uptoYm));
}

export type DeferralInput = Omit<Deferral, 'id' | 'createdAt' | 'stopped'>;

/** Add or change a schedule. A schedule with booked months can only change its name / document / stop flag. */
export async function saveDeferral(tx: Tx, a: { firmId: string; userId: string | null; id?: string | null; d: DeferralInput }): Promise<Deferral> {
  const err = deferralError(a.d);
  if (err) throw new PostingError('empty', err);
  const f = await lockFirm(tx, a.firmId);
  const L = listOf(f.settings);
  const clean: DeferralInput = {
    name: a.d.name.trim().slice(0, 160), kind: a.d.kind, amount: Math.round(Number(a.d.amount) * 100) / 100, from: a.d.from,
    months: Math.floor(Number(a.d.months)), konto: a.d.konto, defKonto: a.d.defKonto, partnerId: a.d.partnerId || null, doc: a.d.doc?.trim() || null,
  };
  let out: Deferral;
  if (a.id) {
    const i = L.findIndex((x) => x.id === a.id);
    if (i < 0) throw new PostingError('not_found', 'Распоредот не постои.');
    const old = L[i]!;
    const P = await postedIds(tx, a.firmId);
    const booked = deferralState(old, P, '9999-12').parts.some((p) => p.posted);
    const money = (['kind', 'amount', 'from', 'months', 'konto', 'defKonto'] as const).some((k) => String(old[k]) !== String(clean[k]));
    if (booked && money) throw new PostingError('locked', 'Распоредот има книжени месеци – износот, месеците и контата не може да се менуваат. Поништете ги книжените месеци или запрете го распоредот и отворете нов.');
    out = { ...old, ...clean };
    L[i] = out;
  } else {
    out = { id: randomUUID(), ...clean, createdAt: new Date().toISOString() };
    L.push(out);
  }
  await saveList(tx, a.firmId, f.settings, L);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: a.id ? 'deferralEdit' : 'deferralAdd', entityType: 'deferral', entityId: out.id, data: out as unknown as Record<string, unknown> });
  return out;
}

export async function stopDeferral(tx: Tx, a: { firmId: string; userId: string | null; id: string; stopped: boolean }) {
  const f = await lockFirm(tx, a.firmId);
  const L = listOf(f.settings);
  const d = L.find((x) => x.id === a.id);
  if (!d) throw new PostingError('not_found', 'Распоредот не постои.');
  d.stopped = a.stopped;
  await saveList(tx, a.firmId, f.settings, L);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: a.stopped ? 'deferralStop' : 'deferralResume', entityType: 'deferral', entityId: a.id, data: { name: d.name } });
}

/** Delete a schedule that has no booked month. */
export async function deleteDeferral(tx: Tx, a: { firmId: string; userId: string | null; id: string }) {
  const f = await lockFirm(tx, a.firmId);
  const L = listOf(f.settings);
  const d = L.find((x) => x.id === a.id);
  if (!d) throw new PostingError('not_found', 'Распоредот не постои.');
  const [j] = await tx.select({ id: journals.id }).from(journals)
    .where(and(eq(journals.firmId, a.firmId), eq(journals.sourceType, DEFERRAL_SOURCE), like(journals.sourceId, `${a.id}:%`))).limit(1);
  if (j) throw new PostingError('locked', 'Распоредот има книжени месеци – прво поништете ги, или запрете го распоредот.');
  await saveList(tx, a.firmId, f.settings, L.filter((x) => x.id !== a.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'deferralDel', entityType: 'deferral', entityId: a.id, data: { name: d.name } });
}

/**
 * Book every month due up to `uptoYm` (all schedules, or one): one journal per schedule and month, dated the month end.
 * Months in a locked period are skipped and reported, the others are booked.
 */
export async function postDeferralsDue(tx: Tx, a: { firmId: string; userId: string | null; uptoYm: string; id?: string | null }) {
  const S = (await deferralStates(tx, a.firmId, a.uptoYm)).filter((s) => !a.id || s.d.id === a.id);
  let n = 0, total = 0;
  const skipped: string[] = [];
  for (const s of S) {
    for (const p of s.due) {
      const date = monthEndOf(p.ym);
      try {
        await tx.transaction(async (t) => {
          await postJournal(t, {
            firmId: a.firmId, date, kind: 'manual', sourceType: DEFERRAL_SOURCE, sourceId: deferralSourceId(s.d.id, p.ym),
            description: `Разграничување: ${s.d.name} ${p.no}/${s.d.months}`, lines: deferralLines(s.d, p),
            userId: a.userId, requirePartner: false, auditAction: 'deferralPost', periodFrom: `${p.ym}-01`, periodTo: date,
            meta: { deferralId: s.d.id, ym: p.ym, no: p.no },
          });
        });
        n++; total += p.amount;
      } catch (e) {
        if (e instanceof PostingError && (e.code === 'locked' || e.code === 'vat_closed')) { skipped.push(`${s.d.name} ${p.ym.slice(5)}.${p.ym.slice(0, 4)}`); continue; }
        throw e;
      }
    }
  }
  return { n, total: Math.round(total * 100) / 100, skipped };
}

/** Undo one booked month of a schedule. */
export const undoDeferralMonth = (tx: Tx, a: { firmId: string; userId: string | null; id: string; ym: string }) =>
  unpostSource(tx, { firmId: a.firmId, sourceType: DEFERRAL_SOURCE, sourceId: deferralSourceId(a.id, a.ym), userId: a.userId });

const monthEndOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
