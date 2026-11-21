import 'server-only';
/** Donations & sponsorships screen data: contracts, linked statement lines, statement lines that look like donations. */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { donChart, donMovesFromBank, type DonMove } from '@wise/core/donations';
import { yeEntityOf } from '@wise/core';
import { bankAccounts, bankLines, bankStatements, donationReceipts, donations, effectiveChart, fileLinks, DONATION_FILE_ENTITY, type Donation, type Firm } from '@wise/db';
import { db } from '@/lib/db';

export type LinkedMove = { id: string; date: string; amt: number; src: string; konto: string | null; partnerId: string | null; desc: string };

export const isNpoFirm = (firm: Firm) => yeEntityOf({ ent: (firm.settings as Record<string, unknown> | null)?.ent, legalForm: firm.legalForm, name: firm.name }) === 'npo';

/** All the firm's donations; statement lines of `year` that look like donations; the lines linked to any contract. */
export async function donData(firm: Firm, year: number) {
  const [D, chart, B, A] = await Promise.all([
    db().select().from(donations).where(eq(donations.firmId, firm.id)).orderBy(asc(donations.date)),
    effectiveChart(db(), firm.id),
    db().select({ id: bankLines.id, date: bankLines.date, amount: bankLines.amount, osnov: bankLines.osnov, desc: bankLines.description, name: bankLines.name, konto: bankLines.konto, partnerId: bankLines.partnerId })
      .from(bankLines).where(and(eq(bankLines.firmId, firm.id), sql`${bankLines.date} between ${year + '-01-01'} and ${year + '-12-31'}`)),
    db().select({ account: bankAccounts.account, konto: bankAccounts.konto, cur: bankAccounts.cur }).from(bankAccounts).where(and(eq(bankAccounts.firmId, firm.id), eq(bankAccounts.active, true))).orderBy(asc(bankAccounts.sort)),
  ]);
  const codes = new Set(chart.map((a) => a.code));
  const kName = new Map(chart.map((a) => [a.code, a.name]));
  const npo = isNpoFirm(firm);
  // the same chart test as the year-end NPO statements: firms.settings.accounts has 730 „Приходи од членарини“
  const chartMode = donChart(npo, ((firm.settings ?? {}) as { accounts?: Record<string, unknown> }).accounts);
  const flows: DonMove[] = donMovesFromBank(B.map((b) => ({ ...b, amount: Number(b.amount) })), chartMode);
  const linkedIds = [...new Set(D.flatMap((d) => d.moveIds))];
  const L = linkedIds.length
    ? await db().select({ id: bankLines.id, date: bankLines.date, amount: bankLines.amount, konto: bankLines.konto, partnerId: bankLines.partnerId, desc: bankLines.description, name: bankLines.name, stNo: bankStatements.number })
      .from(bankLines).innerJoin(bankStatements, eq(bankStatements.id, bankLines.statementId))
      .where(and(eq(bankLines.firmId, firm.id), inArray(bankLines.id, linkedIds)))
    : [];
  const lineOf = new Map<string, LinkedMove>(L.map((l) => [l.id, { id: l.id, date: l.date, amt: Math.abs(Number(l.amount)), src: 'Извод бр. ' + (l.stNo ?? ''), konto: l.konto, partnerId: l.partnerId, desc: [l.name, l.desc].filter(Boolean).join(' – ') }]));
  const linked = new Set(linkedIds);
  const unlinked = flows.filter((f) => !linked.has(f.id));
  const files = D.length ? await db().select({ id: fileLinks.entityId, fileId: fileLinks.fileId }).from(fileLinks).where(and(eq(fileLinks.entityType, DONATION_FILE_ENTITY), inArray(fileLinks.entityId, D.map((d) => d.id)))) : [];
  const fileOf = new Map<string, string[]>();
  for (const f of files) fileOf.set(f.id, [...(fileOf.get(f.id) ?? []), f.fileId]);
  // goods of a donation in kind received through the kitchen приемници (🍲 /obroci)
  const RC = D.length ? await db().select({ id: donationReceipts.donationId, t: sql<string>`sum(${donationReceipts.total})` }).from(donationReceipts)
    .where(and(eq(donationReceipts.firmId, firm.id), inArray(donationReceipts.donationId, D.map((d) => d.id)))).groupBy(donationReceipts.donationId) : [];
  const recOf = new Map(RC.filter((r) => r.id).map((r) => [r.id!, Number(r.t)]));
  const mkd = A.find((a) => a.cur === 'MKD') ?? A[0];
  return { list: D, recOf, flows, unlinked, lineOf, fileOf, npo, chartMode, codes, kName, firmAcct: mkd?.account ?? '', bankKonto: mkd?.konto ?? (chartMode === 'npo' ? '100' : '1000') };
}

/** Realised amount: the confirmation amount, else the kitchen receipts of the goods, else the booked in-kind value, else the linked statement lines. */
export const realizedOf = (d: Pick<Donation, 'id' | 'confAmount' | 'moveIds' | 'inKind' | 'journalId' | 'amount'>, lineOf: Map<string, LinkedMove>, recOf?: Map<string, number>) =>
  d.confAmount != null ? Number(d.confAmount) : d.inKind && recOf?.get(d.id) ? recOf.get(d.id)! : d.inKind && d.journalId ? Number(d.amount) : d.moveIds.reduce((s, id) => s + (lineOf.get(id)?.amt ?? 0), 0);
