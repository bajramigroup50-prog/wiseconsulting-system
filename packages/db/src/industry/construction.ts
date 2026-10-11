/**
 * Construction service (legacy ACT `cpNewB … consCfgSave` 10089): projects with the bill of quantities, situations
 * invoiced through Phase 3 (art. 32-a reverse charge when the project says so), diary, cost links and project result.
 *
 * FIX (LEGACY-MAP 10.4 item 2): legacy kept the open project in `S.cpEd`, the same state slot as the coupon editor,
 * so opening a coupon and then `gradba` showed the coupon as a project. Here the project is a route parameter of its
 * own page; there is no shared editor state.
 */
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { consConfig, diaryCost, nextModuleNumber, situationCalc, situationInvoiceLines, sortSituations, type ConsConfig } from '@wise/core/industry';
import { audit, type Tx } from '../audit';
import {
  cashVouchers, constructionCostLinks, constructionDiary, constructionProjects, constructionSituations, invoices, partners, purchases,
  type ConstructionProject, type Firm,
} from '../schema/index';
import type { BoqRow } from '../schema/industry';
import { assertPartner, IndustryError, industryConfigOf, issueModuleInvoice, loadIndustryFirm, n, type IndActor } from './context';

const MOD = 'cons';
const fail = (m: string): never => { throw new IndustryError(m); };
export const firmConsConfig = (f: Pick<Firm, 'settings'>): ConsConfig => consConfig(industryConfigOf<ConsConfig>(f, 'cons'));

export interface ProjectInput {
  id?: string | null; code?: string | null; name: string; site?: string | null; city?: string | null; investorId: string; cno?: string | null;
  cdate?: string | null; start?: string | null; end?: string | null; nadzor?: string | null; eng?: string | null; art32?: boolean; boq?: BoqRow[];
}

async function ownProject(tx: Tx, firmId: string, id: string): Promise<ConstructionProject> {
  const [p] = await tx.select().from(constructionProjects).where(and(eq(constructionProjects.id, id), eq(constructionProjects.firmId, firmId))).limit(1);
  return p ?? fail('Објектот не постои.');
}

/** Legacy `cpSaveB`. FIX (10.4 item 12): the code is the next free number, not `count + 1`. */
export async function saveProject(tx: Tx, a: IndActor, p: ProjectInput): Promise<{ id: string; code: string }> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const prev = p.id ? await ownProject(tx, a.firmId, p.id) : null;
  const name = p.name.trim() || fail('Внесете назив на објектот.');
  const investorId = (await assertPartner(tx, a.firmId, p.investorId)) ?? fail('Изберете инвеститор.');
  const boq = (p.boq ?? prev?.boq ?? []).filter((l) => l.desc?.trim()).map((l) => ({ pos: l.pos ?? '', desc: l.desc.trim(), unit: l.unit ?? '', qty: n(l.qty), price: n(l.price) }));
  if (prev && prev.boq.length > boq.length) {
    const [s] = await tx.select({ id: constructionSituations.id }).from(constructionSituations).where(eq(constructionSituations.projectId, prev.id)).limit(1);
    if (s) fail('Има ситуации – позиции од предмерот не може да се бришат (додавајте нови или ставете количина 0).');
  }
  let code = p.code?.trim() || prev?.code || '';
  if (!code) code = nextModuleNumber('О-', (await tx.select({ c: constructionProjects.code }).from(constructionProjects).where(eq(constructionProjects.firmId, a.firmId))).map((r) => r.c), new Date().getFullYear());
  const [dup] = await tx.select({ id: constructionProjects.id }).from(constructionProjects).where(and(eq(constructionProjects.firmId, a.firmId), eq(constructionProjects.code, code), prev ? ne(constructionProjects.id, prev.id) : undefined)).limit(1);
  if (dup) fail(`Шифрата ${code} веќе постои.`);
  const d = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const row = {
    code, name, site: p.site?.trim() || null, city: p.city?.trim() || null, investorId, cno: p.cno?.trim() || null, cdate: d(p.cdate), start: d(p.start), end: d(p.end),
    nadzor: p.nadzor?.trim() || null, eng: p.eng?.trim() || null, art32: !!p.art32, boq,
  };
  let id = prev?.id ?? '';
  if (prev) await tx.update(constructionProjects).set(row).where(eq(constructionProjects.id, id));
  else id = (await tx.insert(constructionProjects).values({ ...row, firmId: a.firmId }).returning({ id: constructionProjects.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: prev ? 'cpSave' : 'cpNew', entityType: 'construction_project', entityId: id, data: { code, boq: boq.length } });
  return { id, code };
}

export interface SituationInput { id?: string | null; projectId: string; no: string; kind: 'int' | 'fin'; date: string; from?: string | null; to?: string | null; cum: Record<string, number> }

/** Legacy `csSave`: a final situation closes the project. Invoiced situations are frozen. */
export async function saveSituation(tx: Tx, a: IndActor, s: SituationInput): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  const P = await ownProject(tx, a.firmId, s.projectId);
  const [prev] = s.id ? await tx.select().from(constructionSituations).where(and(eq(constructionSituations.id, s.id), eq(constructionSituations.projectId, P.id))).limit(1) : [];
  if (s.id && !prev) fail('Ситуацијата не постои.');
  if (prev?.invoiceId) fail('Ситуацијата е фактурирана.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) fail('Внесете датум.');
  const no = s.no.trim() || fail('Внесете број на ситуацијата.');
  const [dup] = await tx.select({ id: constructionSituations.id }).from(constructionSituations).where(and(eq(constructionSituations.projectId, P.id), eq(constructionSituations.no, no), prev ? ne(constructionSituations.id, prev.id) : undefined)).limit(1);
  if (dup) fail(`Ситуација бр. ${no} веќе постои.`);
  const cum = Object.fromEntries(Object.entries(s.cum).filter(([i, q]) => Number(i) < P.boq.length && n(q)).map(([i, q]) => [i, n(q)]));
  const row = { no, kind: s.kind === 'fin' ? 'fin' as const : 'int' as const, date: s.date, from: s.from || null, to: s.to || null, cum };
  let id = prev?.id ?? '';
  if (prev) await tx.update(constructionSituations).set(row).where(eq(constructionSituations.id, id));
  else id = (await tx.insert(constructionSituations).values({ ...row, firmId: a.firmId, projectId: P.id }).returning({ id: constructionSituations.id }))[0]!.id;
  await tx.update(constructionProjects).set({ status: row.kind === 'fin' ? 'done' : 'open' }).where(eq(constructionProjects.id, P.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'csSave', entityType: 'construction_situation', entityId: id, data: { project: P.code, no } });
  return id;
}

export const projectSituations = (tx: Tx, projectId: string) =>
  tx.select().from(constructionSituations).where(eq(constructionSituations.projectId, projectId)).orderBy(asc(constructionSituations.date));

/** Legacy `csInv`: the situation's executed quantities as a Phase 3 invoice to the investor (32-a when set). */
export async function invoiceSituation(tx: Tx, a: IndActor, id: string, date: string) {
  const f = await loadIndustryFirm(tx, a.firmId, MOD, a);
  const [s] = await tx.select().from(constructionSituations).where(and(eq(constructionSituations.id, id), eq(constructionSituations.firmId, a.firmId))).limit(1);
  if (!s) fail('Ситуацијата не постои.');
  if (s!.invoiceId) fail('Ситуацијата е веќе фактурирана.');
  const P = await ownProject(tx, a.firmId, s!.projectId);
  const all = sortSituations(await projectSituations(tx, P.id));
  const lines = situationInvoiceLines(situationCalc(P.boq, all, s!), firmConsConfig(f));
  if (!lines.length) fail('Нема изведени количини во оваа ситуација.');
  const inv = await issueModuleInvoice(tx, a, {
    partnerId: P.investorId, date, lines, art32: P.art32, data: { source: { type: 'construction_situation', id: s!.id } },
    note: `${s!.kind === 'fin' ? 'Окончателна' : 'Привремена'} ситуација бр. ${s!.no} · ${P.name}${P.cno ? ' · договор ' + P.cno : ''}`,
  });
  await tx.update(constructionSituations).set({ invoiceId: inv.id }).where(eq(constructionSituations.id, id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'csInv', entityType: 'construction_situation', entityId: id, data: { invoice: inv.number } });
  return inv;
}

export interface DiaryInput { id?: string | null; projectId: string; date: string; weather?: string | null; temp?: string | null; works?: string | null; mat?: string | null; issues?: string | null; nadzor?: string | null; workers?: { emp: string; name: string; hrs: number; rate: number }[]; mach?: { name: string; hrs: number; rate: number }[] }

export async function saveDiary(tx: Tx, a: IndActor, d: DiaryInput): Promise<string> {
  const f = await loadIndustryFirm(tx, a.firmId, MOD, a);
  const P = await ownProject(tx, a.firmId, d.projectId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) fail('Внесете датум.');
  const hr = firmConsConfig(f).hr;
  const row = {
    date: d.date, weather: d.weather || null, temp: d.temp || null, works: d.works || null, mat: d.mat || null, issues: d.issues || null, nadzor: d.nadzor || null,
    workers: (d.workers ?? []).map((w) => ({ ...w, rate: n(w.rate) || hr })), mach: (d.mach ?? []).filter((x) => x.name?.trim()),
  };
  let id = d.id ?? '';
  if (id) {
    const [u] = await tx.update(constructionDiary).set(row).where(and(eq(constructionDiary.id, id), eq(constructionDiary.projectId, P.id))).returning({ id: constructionDiary.id });
    if (!u) fail('Записот не постои.');
  } else id = (await tx.insert(constructionDiary).values({ ...row, firmId: a.firmId, projectId: P.id }).returning({ id: constructionDiary.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'cdSave', entityType: 'construction_diary', entityId: id, data: { project: P.code, date: d.date } });
  return id;
}

/** Legacy `pcLink`: tag purchases / cash payments as costs of the project (a document belongs to one project). */
export async function linkCosts(tx: Tx, a: IndActor, projectId: string, refs: { type: 'purchase' | 'cash_voucher'; id: string }[], unlink = false): Promise<number> {
  await loadIndustryFirm(tx, a.firmId, MOD, a);
  await ownProject(tx, a.firmId, projectId);
  let k = 0;
  for (const r of refs) {
    const tbl = r.type === 'purchase' ? purchases : cashVouchers;
    const [x] = await tx.select({ id: tbl.id }).from(tbl).where(and(eq(tbl.id, r.id), eq(tbl.firmId, a.firmId))).limit(1);
    if (!x) fail('Документот не постои.');
    await tx.delete(constructionCostLinks).where(and(eq(constructionCostLinks.sourceType, r.type), eq(constructionCostLinks.sourceId, r.id)));
    if (!unlink) await tx.insert(constructionCostLinks).values({ firmId: a.firmId, projectId, sourceType: r.type, sourceId: r.id });
    k++;
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: unlink ? 'pcUnlink' : 'pcLink', entityType: 'construction_project', entityId: projectId, data: { n: k } });
  return k;
}

/** Legacy `projCosts`: purchases (base), cash payments (amount), diary labour and machines, invoiced revenue (base). */
export async function projectCosts(tx: Tx, f: Firm, P: ConstructionProject) {
  const links = await tx.select().from(constructionCostLinks).where(eq(constructionCostLinks.projectId, P.id));
  const pIds = links.filter((l) => l.sourceType === 'purchase').map((l) => l.sourceId), vIds = links.filter((l) => l.sourceType === 'cash_voucher').map((l) => l.sourceId);
  const pur = pIds.length ? await tx.select({ id: purchases.id, date: purchases.date, number: purchases.number, base: purchases.base, fx: purchases.fx, cur: purchases.currency, who: partners.name, sname: purchases.supplierName })
    .from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId)).where(inArray(purchases.id, pIds)) : [];
  const blg = vIds.length ? await tx.select().from(cashVouchers).where(inArray(cashVouchers.id, vIds)) : [];
  const cfg = firmConsConfig(f);
  const D = await tx.select().from(constructionDiary).where(eq(constructionDiary.projectId, P.id));
  const S = await tx.select({ inv: invoices.base }).from(constructionSituations).innerJoin(invoices, eq(invoices.id, constructionSituations.invoiceId)).where(eq(constructionSituations.projectId, P.id));
  const L = [
    ...pur.map((p) => ({ d: p.date, t: 'Влезна фактура ' + p.number, who: p.who ?? p.sname ?? '', amt: Math.round(n(p.base) * (p.cur === 'MKD' ? 1 : n(p.fx) || 1) * 100) / 100, ref: { type: 'purchase' as const, id: p.id } })),
    ...blg.map((v) => ({ d: v.date, t: 'Исплатница ' + v.number, who: v.merchant ?? '', amt: Math.round((n(v.amt) * n(v.fx) - n(v.vat) * n(v.fx)) * 100) / 100, ref: { type: 'cash_voucher' as const, id: v.id } })),
    ...D.flatMap((d) => { const c = diaryCost(d, cfg); return [c.lab ? { d: d.date, t: 'Дневник: работници', who: `${d.workers.length} лица`, amt: c.lab, ref: null } : null, c.mach ? { d: d.date, t: 'Дневник: машини', who: d.mach.map((m) => m.name).join(', '), amt: c.mach, ref: null } : null].filter((x) => !!x); }),
  ].sort((x, y) => x.d.localeCompare(y.d));
  const sum = (k: (x: (typeof L)[number]) => boolean) => Math.round(L.filter(k).reduce((s, x) => s + x.amt, 0) * 100) / 100;
  const rev = Math.round(S.reduce((s, x) => s + n(x.inv), 0) * 100) / 100;
  return { L, tot: sum(() => true), pur: sum((x) => x.ref?.type === 'purchase'), blg: sum((x) => x.ref?.type === 'cash_voucher'), lab: sum((x) => !x.ref), rev };
}

/** Purchases / cash payments not yet linked to any project, for the link list. */
export async function unlinkedCosts(tx: Tx, firmId: string, since: string | null) {
  const linked = sql`not exists (select 1 from ${constructionCostLinks} l where l.source_id = `;
  const P = await tx.select({ id: purchases.id, date: purchases.date, number: purchases.number, base: purchases.base, who: partners.name }).from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
    .where(and(eq(purchases.firmId, firmId), eq(purchases.status, 'posted'), since ? sql`${purchases.date} >= ${since}` : undefined, sql`${linked}${purchases.id})`)).orderBy(sql`${purchases.date} desc`).limit(80);
  const V = await tx.select({ id: cashVouchers.id, date: cashVouchers.date, number: cashVouchers.number, amt: cashVouchers.amt, who: cashVouchers.merchant }).from(cashVouchers)
    .where(and(eq(cashVouchers.firmId, firmId), eq(cashVouchers.kind, 'out'), since ? sql`${cashVouchers.date} >= ${since}` : undefined, sql`${linked}${cashVouchers.id})`)).orderBy(sql`${cashVouchers.date} desc`).limit(40);
  return { P, V };
}
