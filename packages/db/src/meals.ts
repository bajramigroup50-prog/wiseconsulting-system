/**
 * „🍲 Корисници и оброци“ services (module `meals`): register of families / persons, the daily meal ticks and the
 * import of the association's Excel register. Every write checks the module (clients) and is audited.
 */
import { and, asc, between, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { isMealKind, sameBeneficiary, type BeneficiaryInput, type MealKind } from '@wise/core/meals';
import { audit, type Tx } from './audit';
import { IndustryError, loadIndustryFirm, type IndActor } from './industry/context';
import { accounts, journalLines, journals, mealBeneficiaries, mealLogs, type MealBeneficiaryRow } from './schema/index';

const fail = (m: string): never => { throw new IndustryError(m); };
const t = (s: string | null | undefined) => (s ?? '').trim() || null;

async function ownBenef(tx: Tx, firmId: string, id: string): Promise<MealBeneficiaryRow> {
  const [r] = await tx.select().from(mealBeneficiaries).where(and(eq(mealBeneficiaries.id, id), eq(mealBeneficiaries.firmId, firmId))).limit(1);
  return r ?? fail('Корисникот не постои.');
}

export async function listBeneficiaries(tx: Tx, firmId: string, all = false) {
  return tx.select().from(mealBeneficiaries)
    .where(and(eq(mealBeneficiaries.firmId, firmId), all ? undefined : eq(mealBeneficiaries.active, true)))
    .orderBy(asc(mealBeneficiaries.no), asc(mealBeneficiaries.name));
}

export async function mealLogsBetween(tx: Tx, firmId: string, from: string, to: string) {
  return tx.select({ beneficiaryId: mealLogs.beneficiaryId, date: mealLogs.date, meal: mealLogs.meal }).from(mealLogs)
    .where(and(eq(mealLogs.firmId, firmId), between(mealLogs.date, from, to)));
}

/** `consentDate`: a date sets the signed consent, `null` clears it, omitted keeps it. */
export async function saveBeneficiary(tx: Tx, a: IndActor, x: BeneficiaryInput & { id?: string | null; active?: boolean; consentDate?: string | null; inactiveFrom?: string | null; today?: string }): Promise<string> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  const name = (x.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) fail('Внесете име и презиме.');
  const members = Math.max(1, Math.min(50, Math.round(Number(x.members) || 1)));
  const embg = (x.embg ?? '').replace(/\D/g, '') || null;
  if (embg && embg.length !== 13) fail('ЕМБГ има 13 цифри.');
  if (x.consentDate && !/^\d{4}-\d{2}-\d{2}$/.test(x.consentDate)) fail('Невалиден датум на согласноста.');
  if (x.inactiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(x.inactiveFrom)) fail('Невалиден датум „неактивен од“.');
  // a date „неактивен од“ makes the person inactive from that day; inactive without a date = from today; active clears it
  const active = x.inactiveFrom ? false : x.active ?? true;
  const inactiveFrom = active ? null : x.inactiveFrom || x.today || new Date().toISOString().slice(0, 10);
  const v = {
    no: x.no ?? null, name, members, nationality: t(x.nationality), embg, place: t(x.place), phone: t(x.phone), note: t(x.note), active, inactiveFrom, updatedAt: new Date(),
    ...(x.consentDate !== undefined ? { consentDate: x.consentDate || null } : {}),
  };
  let id = x.id ?? '';
  if (id) { await ownBenef(tx, a.firmId, id); await tx.update(mealBeneficiaries).set(v).where(eq(mealBeneficiaries.id, id)); }
  else id = (await tx.insert(mealBeneficiaries).values({ ...v, firmId: a.firmId }).returning({ id: mealBeneficiaries.id }))[0]!.id;
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: x.id ? 'mealBenSave' : 'mealBenNew', entityType: 'meal_beneficiary', entityId: id, data: { name, members, active: v.active, inactiveFrom, ...(x.consentDate !== undefined ? { consent: x.consentDate || null } : {}) } });
  return id;
}

/** Tick / untick one meal of one beneficiary on a day. Returns the new state. */
export async function setMeal(tx: Tx, a: IndActor, beneficiaryId: string, date: string, meal: MealKind, on: boolean): Promise<boolean> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  if (!isMealKind(meal)) fail('Непознат оброк.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Невалиден датум.');
  const b = await ownBenef(tx, a.firmId, beneficiaryId);
  if (on) await tx.insert(mealLogs).values({ firmId: a.firmId, beneficiaryId, date, meal, userId: a.userId }).onConflictDoNothing();
  else await tx.delete(mealLogs).where(and(eq(mealLogs.beneficiaryId, beneficiaryId), eq(mealLogs.date, date), eq(mealLogs.meal, meal)));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: on ? 'mealOn' : 'mealOff', entityType: 'meal_beneficiary', entityId: b.id, data: { date, meal } });
  return on;
}

/** Tick every meal kind given for all listed beneficiaries on a day (the „сите дојдоа“ shortcut). */
export async function setMealsBulk(tx: Tx, a: IndActor, ids: readonly string[], date: string, meal: MealKind): Promise<number> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  if (!isMealKind(meal) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Невалиден оброк или датум.');
  const own = new Set((await listBeneficiaries(tx, a.firmId)).map((b) => b.id));
  const L = ids.filter((id) => own.has(id));
  if (L.length) await tx.insert(mealLogs).values(L.map((beneficiaryId) => ({ firmId: a.firmId, beneficiaryId, date, meal, userId: a.userId }))).onConflictDoNothing();
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'mealBulk', entityType: 'meal_log', data: { date, meal, n: L.length } });
  return L.length;
}

/**
 * Import the association's register: new people are added, people already in the register (same ЕМБГ, else the
 * same name) are updated with the non-empty imported values. Returns how many were added / updated.
 */
export async function importBeneficiaries(tx: Tx, a: IndActor, list: readonly BeneficiaryInput[]): Promise<{ added: number; updated: number }> {
  await loadIndustryFirm(tx, a.firmId, 'meals', a);
  const have = await listBeneficiaries(tx, a.firmId, true);
  let added = 0, updated = 0;
  for (const x of list) {
    const old = have.find((h) => sameBeneficiary(h, x));
    const embg = (x.embg ?? '').replace(/\D/g, '');
    const v = {
      no: x.no ?? old?.no ?? null, name: x.name.trim(), members: Math.max(1, Math.round(x.members || old?.members || 1)),
      nationality: t(x.nationality) ?? old?.nationality ?? null, embg: embg.length === 13 ? embg : old?.embg ?? (embg || null),
      place: t(x.place) ?? old?.place ?? null, phone: t(x.phone) ?? old?.phone ?? null, note: t(x.note) ?? old?.note ?? null, updatedAt: new Date(),
    };
    if (old) { await tx.update(mealBeneficiaries).set({ ...v, active: true }).where(eq(mealBeneficiaries.id, old.id)); updated++; }
    else { const [r] = await tx.insert(mealBeneficiaries).values({ ...v, firmId: a.firmId }).returning(); have.push(r!); added++; }
  }
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'mealImport', entityType: 'meal_beneficiary', data: { added, updated } });
  return { added, updated };
}

/**
 * Movements of the books for the meals report: per account of class 4 (расходи) and 7 (приходи – донации, членарини…)
 * the debit / credit turnover between two dates, without the opening and closing journals. With the account names.
 */
export async function npoMovements(tx: Tx, firmId: string, from: string, to: string) {
  const R = await tx.select({
    account: journalLines.account,
    debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
    credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
  }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), between(journals.date, from, to), notInArray(journals.kind, ['open', 'close']),
      sql`(left(${journalLines.account}, 1) in ('4', '7'))`))
    .groupBy(journalLines.account).orderBy(journalLines.account);
  const A = R.length ? await tx.select({ code: accounts.code, name: accounts.name, firmId: accounts.firmId }).from(accounts)
    .where(and(inArray(accounts.code, R.map((r) => r.account)), or(eq(accounts.firmId, firmId), isNull(accounts.firmId)))) : [];
  // the firm's own chart wins over the common one
  const names = new Map<string, string>();
  for (const x of A) if (x.firmId || !names.has(x.code)) names.set(x.code, x.name);
  return R.map((r) => ({ account: r.account, name: names.get(r.account) ?? '', debit: Number(r.debit), credit: Number(r.credit) }));
}
