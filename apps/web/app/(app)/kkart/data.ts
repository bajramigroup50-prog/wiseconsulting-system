import 'server-only';
/**
 * Account card data (legacy `kkData` 6679 + `kkTable` 12823 / `kkXlsx` 12828): lines of one konto (or its sub-kontos),
 * with the legacy columns — Р.бр. во налог, Налог, Налог датум, Датум книж., Содржина / фак. бр. (`kkSod` 12816),
 * Докум. / калк. (`kkCalc`), Забелешка, Комитент, Датум на валута (`kcDue` 6429).
 */
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm';
import { accountCard, type LedgerLine } from '@wise/core';
import { effectiveChart, invoices, journalLines, journals, partners, purchases } from '@wise/db';
import { inYearOr, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';

export type KkSP = { k?: string; sub?: string; p?: string; from?: string; to?: string };

const U = (x: unknown) => String(x ?? '').toUpperCase();

/** Legacy `kkSod` 12816: the content column by source document. */
export function kkSod(l: { sourceType: string | null; kind: string; description: string | null; doc: string | null; statementNo?: string | null }): string {
  const d = String(l.doc ?? '').trim();
  if (l.sourceType === 'bank_statement' || l.kind === 'bank') {
    const n = l.statementNo || /бр\.\s*(\S+)/i.exec(l.description ?? '')?.[1] || '';
    return 'ИЗВОД БР ' + n + (d && d !== String(n) ? ' · Ф-РА ' + U(d) : '');
  }
  if (l.sourceType === 'invoice') return (/^Одобрение/.test(l.description ?? '') ? 'ОДОБРЕНИЕ БР ' : 'ФАКТУРА БР ') + U(d);
  if (l.sourceType === 'purchase') return 'ВЛЕЗНА Ф-РА БР ' + U(d);
  return U(l.description).replace(/\s+ОД\s+\d{2}\.\d{2}\.\d{4}.*$/, '').replace(/БР\.\s*/, 'БР ');
}

export async function kkData(firmId: string, year: number, sp: KkSP) {
  const k = /^\d{1,10}$/.test(sp.k ?? '') ? sp.k! : '1020';
  const sub = sp.sub === '1';
  const from = inYearOr(sp.from, year, `${year}-01-01`), to = inYearOr(sp.to, year, `${year}-12-31`);
  const [chart, P] = await Promise.all([effectiveChart(db(), firmId), partnerOptions(firmId)]);
  const noPartner = sp.p === 'none';
  const pf = !noPartner && sp.p && P.some((p) => p.id === sp.p) ? sp.p : null;
  const rows = await db().select({
    id: journalLines.id, account: journalLines.account, debit: journalLines.debit, credit: journalLines.credit, partnerId: journalLines.partnerId,
    note: journalLines.note, doc: journalLines.doc, lineNo: journalLines.lineNo,
    date: journals.date, kind: journals.kind, journalId: journals.id, number: journals.number, description: journals.description,
    sourceType: journals.sourceType, sourceId: journals.sourceId, meta: journals.meta,
    pcode: partners.code, pname: partners.name,
  }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId)).leftJoin(partners, eq(partners.id, journalLines.partnerId))
    .where(and(eq(journalLines.firmId, firmId), sql`${journals.date} between ${year + '-01-01'} and ${to}`,
      sub ? like(journalLines.account, `${k}%`) : eq(journalLines.account, k)))
    .orderBy(asc(journals.date), asc(journals.createdAt), asc(journals.id), asc(journalLines.lineNo));
  const pinfo = new Map(rows.map((r) => [r.partnerId, r.pname ? (r.pcode ? r.pcode + ' ' : '') + r.pname : '']));
  const L: LedgerLine[] = rows.map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
  const X = accountCard(L, { account: k, sub, partnerId: pf, noPartner, from, to });
  // documents: due date and calculation number
  const uuid = (x: string | null) => !!x && /^[0-9a-f-]{36}$/i.test(x);
  const invIds = [...new Set(rows.filter((r) => r.sourceType === 'invoice' && uuid(r.sourceId)).map((r) => r.sourceId!))];
  const purIds = [...new Set(rows.filter((r) => r.sourceType === 'purchase' && uuid(r.sourceId)).map((r) => r.sourceId!))];
  const [I, Pu] = await Promise.all([
    invIds.length ? db().select({ id: invoices.id, due: invoices.due }).from(invoices).where(inArray(invoices.id, invIds)) : [],
    purIds.length ? db().select({ id: purchases.id, due: purchases.due, calc: purchases.calcNo }).from(purchases).where(inArray(purchases.id, purIds)) : [],
  ]);
  const due = new Map<string, string | null>([...I.map((x) => [x.id, x.due] as const), ...Pu.map((x) => [x.id, x.due] as const)]);
  const calc = new Map(Pu.map((x) => [x.id, x.calc ?? '']));
  // nalog date (end of the nalog) and the row number inside the nalog (legacy `kkRowNo`)
  const nums = [...new Set(rows.map((r) => r.number))];
  const NJ = nums.length ? await db().select({ id: journalLines.id, number: journals.number, date: journals.date }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journals.firmId, firmId), inArray(journals.number, nums), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`))
    .orderBy(asc(journals.date), asc(journals.createdAt), asc(journals.id), asc(journalLines.lineNo)) : [];
  const ndate = new Map<string, string>(), rowNo = new Map<number, number>(), cnt = new Map<string, number>();
  for (const x of NJ) {
    if (!ndate.has(x.number) || x.date > ndate.get(x.number)!) ndate.set(x.number, x.date);
    const c = (cnt.get(x.number) ?? 0) + 1;
    cnt.set(x.number, c);
    rowNo.set(x.id, c);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ext = (l: LedgerLine) => {
    const r = byId.get((l as LedgerLine & { id: number }).id)!;
    return {
      rb: rowNo.get(r.id) ?? '', nd: ndate.get(r.number) ?? '', sod: kkSod({ ...r, statementNo: String(((r.meta ?? {}) as { statementNo?: string }).statementNo ?? '') }),
      calc: r.sourceType === 'purchase' && r.sourceId ? calc.get(r.sourceId) ?? '' : '', due: r.sourceId ? due.get(r.sourceId) ?? '' : '',
      partner: pinfo.get(r.partnerId ?? null) ?? '',
    };
  };
  const name = chart.find((a) => a.code === k)?.name ?? '';
  const subT = pf ? ' · ' + (P.find((p) => p.id === pf)?.name ?? '') : noPartner ? ' · без комитент' : '';
  return { k, sub, from, to, pf, noPartner, X, ext, name, subT, chart, P };
}
