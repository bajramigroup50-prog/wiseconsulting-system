/**
 * Donations and sponsorships (Закон за донации и спонзорства во јавните дејности, „Сл. весник на РМ“ бр. 47/06 и
 * измени): contracts of a client firm that RECEIVES a donation / sponsorship (здружение, фондација, спортски клуб —
 * a non-profit) or GIVES one (a company — the donor; ЗДД чл. 9: donations up to 5% and sponsorships up to 3% of the
 * total revenue are recognised expenses), the confirmation of the realised donation, numbering, per-donor totals,
 * statement lines that look like donations, and the booking proposal of both sides.
 */
import { r2 } from './money';

export type DonKind = 'donation' | 'sponsorship';
/** `received`: the firm is the recipient (корисник); `given`: the firm is the donor / sponsor. */
export type DonRole = 'received' | 'given';
export type DonChart = 'co' | 'npo';

export const DON_KIND_LBL: Record<DonKind, string> = { donation: 'Донација', sponsorship: 'Спонзорство' };
/** Party names in the contracts (donor / recipient). */
export const DON_PARTY: Record<DonKind, { giver: string; taker: string }> = {
  donation: { giver: 'Донатор', taker: 'Примател на донацијата' },
  sponsorship: { giver: 'Спонзор', taker: 'Примател на спонзорството' },
};

/** Public-interest areas (јавни дејности) a donation / sponsorship may be given for. */
export const DON_AREAS: readonly string[] = [
  'спорт', 'култура', 'образование', 'наука', 'здравство', 'социјална заштита', 'хуманитарна дејност',
  'заштита на децата и младите', 'заштита на лицата со посебни потреби', 'заштита на животната средина',
  'заштита на човековите права', 'друга јавна дејност',
];

/**
 * Default counter kontos of the booking proposal (the bank / cash / asset side is the other one).
 * Recipient, company chart: 7673 донации во земјата (money), 7672 донации во добра, 7694 спонзорства;
 * recipient, the three-digit NPO chart (Сл. весник 117/05): 731 подароци, донации и други извори.
 * Donor, company chart: 4433 донации во земјата, 4430 спонзорства во земјата; donor on the NPO chart (an NPO that
 * helps others): 450 помошти и донации на правни субјекти (451 физички лица — chosen in the contract).
 */
export function donKonto(kind: DonKind, role: DonRole, chart: DonChart = 'co', inKind = false): string {
  if (role === 'given') return chart === 'npo' ? '450' : kind === 'sponsorship' ? '4430' : '4433';
  if (chart === 'npo') return '731';
  return kind === 'sponsorship' ? '7694' : inKind ? '7672' : '7673';
}

/**
 * The firm books on the NPO chart when it is a non-profit and its chart (`firms.settings.accounts`) has 730
 * „Приходи од членарини“ — the same test as the year-end NPO statements (`npoChart`), so both use one chart.
 */
export const donChart = (isNpo: boolean, accounts: Readonly<Record<string, unknown>> | null | undefined): DonChart =>
  isNpo && accounts && accounts['730'] ? 'npo' : 'co';

/** Default counter konto of an in-kind donation: materials (recipient) / goods given (donor); NPO chart 310. */
export const donAssetKonto = (role: DonRole, chart: DonChart = 'co'): string =>
  chart === 'npo' ? '310' : role === 'received' ? '3100' : '6600';

/** Next number `n/yyyy` within the same kind and year (contracts) — or among the confirmations. */
export function nextDonNo(existing: readonly { no?: string | null; date?: string | null }[], y: string): string {
  const n = existing.filter((l) => String(l.date ?? '').startsWith(y)).map((l) => parseInt(String(l.no || '').replace(/^\D+/, '').split('/')[0]!) || 0);
  return (Math.max(0, ...n) + 1) + '/' + y;
}

export interface DonRow { id: string; kind: DonKind; role: DonRole; partnerId: string | null; partnerName?: string | null; date: string; amount: number; realized?: number | null; inKind?: boolean }

/** Totals per donor / recipient and year (contracted and realised), largest first. */
export function donTotals(rows: readonly DonRow[]): { partnerId: string | null; name: string; year: string; n: number; amount: number; realized: number }[] {
  const M = new Map<string, { partnerId: string | null; name: string; year: string; n: number; amount: number; realized: number }>();
  for (const r of rows) {
    const y = r.date.slice(0, 4), k = (r.partnerId ?? 'x:' + (r.partnerName ?? '')) + '|' + y;
    const t = M.get(k) ?? { partnerId: r.partnerId, name: r.partnerName ?? '', year: y, n: 0, amount: 0, realized: 0 };
    t.n++; t.amount = r2(t.amount + r.amount); t.realized = r2(t.realized + (r.realized ?? 0));
    M.set(k, t);
  }
  return [...M.values()].sort((a, b) => b.year.localeCompare(a.year) || b.amount - a.amount);
}

const DON_RE = /донац|донир|спонзор|sponzor|donaci|donacij/i;

export interface DonBankLine { id: string; date: string; amount: number; desc: string; name?: string | null; konto?: string | null; partnerId?: string | null; osnov?: string | null }
export interface DonMove { id: string; date: string; partnerId: string; role: DonRole; kind: DonKind; amt: number; konto: string; desc: string }

/** Is the konto a donation / sponsorship konto (income 767x / 7694 / 731, expense 443x; NPO chart also 450 / 451)? */
export function donKontoKind(k: string | null | undefined, chart: DonChart = 'co'): { role: DonRole; kind: DonKind } | null {
  k = String(k ?? '');
  if (chart === 'npo' && /^45[01]$/.test(k)) return { role: 'given', kind: 'donation' };
  if (/^443[01]/.test(k)) return { role: 'given', kind: 'sponsorship' };
  if (/^443/.test(k)) return { role: 'given', kind: 'donation' };
  if (/^7694/.test(k)) return { role: 'received', kind: 'sponsorship' };
  if (/^767[23]/.test(k) || k === '731') return { role: 'received', kind: 'donation' };
  return null;
}

/**
 * Statement lines that are donations / sponsorships: on a donation konto, or with „донација / спонзорство“ in the text.
 * Inflows are received, outflows given.
 */
export function donMovesFromBank(lines: readonly DonBankLine[], chart: DonChart = 'co'): DonMove[] {
  const out: DonMove[] = [];
  for (const b of lines) {
    const amt = +b.amount || 0;
    if (!amt) continue;
    const kk = donKontoKind(b.konto, chart);
    const txt = (b.desc || '') + ' ' + (b.name || '');
    if (!kk && !DON_RE.test(txt)) continue;
    const role: DonRole = amt > 0 ? 'received' : 'given';
    if (kk && kk.role !== role) continue;
    const kind: DonKind = kk?.kind ?? (/спонзор|sponzor/i.test(txt) ? 'sponsorship' : 'donation');
    out.push({ id: b.id, date: b.date, partnerId: b.partnerId || '', role, kind, amt: r2(Math.abs(amt)), konto: b.konto || '', desc: [b.name, b.desc].filter(Boolean).join(' – ') });
  }
  return out;
}

export interface DonEntry { account: string; debit: number; credit: number; note: string; partner?: boolean }

/**
 * Booking proposal of one realised donation: money through the statement (the counter konto of the line) or, in kind,
 * a nalog Д asset / cost (recipient) or Д 443x / П the given goods (donor).
 */
export function donEntries(d: { kind: DonKind; role: DonRole; amount: number; inKind: boolean; konto: string; bankKonto?: string | null; assetKonto?: string | null; note?: string; chart?: DonChart }): DonEntry[] {
  const a = r2(d.amount), n = d.note ?? DON_KIND_LBL[d.kind];
  const other = d.inKind ? (d.assetKonto || donAssetKonto(d.role, d.chart)) : (d.bankKonto || (d.chart === 'npo' ? '100' : '1000'));
  return d.role === 'received'
    ? [{ account: other, debit: a, credit: 0, note: n }, { account: d.konto, debit: 0, credit: a, note: n, partner: true }]
    : [{ account: d.konto, debit: a, credit: 0, note: n, partner: true }, { account: other, debit: 0, credit: a, note: n }];
}

/** ЗДД чл. 9: recognised share of the donor's total revenue (5% donations, 3% sponsorships). */
export const DON_LIMIT: Record<DonKind, number> = { donation: 0.05, sponsorship: 0.03 };
