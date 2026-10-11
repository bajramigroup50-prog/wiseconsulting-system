/**
 * Off-balance VAT-base lines (legacy `docBases` 3517, `vbLines` 3523, appended to every journal of Излез / Влез / Каса
 * / Поврат in `ledger()` 3451): the base of each VAT rate of the document is booked Д 994… / П 999… (scheme keys
 * `vb<out|in|imp><rate><d|p>`, „-“ = off), note „Основица ДДВ излез 18%“. They feed the ДДВ-04 control card
 * „ДДВ-04 ↔ основици во налозите (994/999)“ (legacy `vbCheckHTML` 3532, {@link vbControl}).
 * The legacy-import ledger (`packages/legacy-import/src/ledger.ts`) reproduces the same lines for imported years.
 */
import { r2 } from './money';
import { schemeValue, type InvoiceDoc, type JournalLine, type PostingContext, type PurchaseDoc } from './posting';
import { advDeduct, calcLines, costsOf } from './vat';

export type VatBaseType = 'out' | 'in' | 'imp';
export interface VatBase { t: VatBaseType; r: number; b: number }

const VB_N: Record<VatBaseType, string> = { out: 'излез', in: 'влез', imp: 'увоз' };
/** Note of a base line (legacy text) — also how the control card recognises the type and rate of a 994 line. */
export const vbNote = (t: VatBaseType, r: number) => `Основица ДДВ ${VB_N[t]} ${r}%`;

function collect(): { add: (t: VatBaseType, r: unknown, b: number) => void; out: () => VatBase[] } {
  const R = new Map<string, VatBase>();
  return {
    add: (t, r0, b) => {
      const r = Number(r0) || 0;
      if (!r || !b) return;
      const k = t + '|' + r;
      const o = R.get(k) ?? { t, r, b: 0 };
      o.b = r2(o.b + b);
      R.set(k, o);
    },
    out: () => [...R.values()],
  };
}

/** Legacy `docBases('Излез')`: bases of the items by rate (credit note negative), minus the deducted advances; none for чл. 32-а. */
export function invoiceVatBases(inv: Pick<InvoiceDoc, 'items' | 'art32' | 'credit' | 'advance' | 'advances'>, ctx: PostingContext): VatBase[] {
  if (inv.art32) return [];
  const C = collect();
  const nonVat = ctx.firm.ddv === false;
  const sg = inv.credit ? -1 : 1;
  for (const g of calcLines(inv.items, false, { nonVat }).by) C.add('out', g.rate, sg * g.base);
  if (!inv.credit && !inv.advance) for (const g of advDeduct(inv.advances, { nonVat }).by) C.add('out', g.rate, -g.base);
  return C.out();
}

/** Legacy `docBases('Влез')`: landed-cost VAT lines (customs `car` → import) + the VAT groups (not import / чл. 32-а). */
export function purchaseVatBases(p: Pick<PurchaseDoc, 'groups' | 'costs' | 'imp' | 'art32'>): VatBase[] {
  const C = collect();
  for (const c of costsOf(p)) for (const l of c.o.lines ?? []) {
    if (!l) continue;
    if (!(Number(l?.vat) || 0)) continue;
    C.add(c.k === 'car' ? 'imp' : 'in', Number(l.rate) || 18, Math.round(Number(l.base) || 0));
  }
  if (!p.imp && !p.art32) for (const g of p.groups) if (Number(g.vat)) C.add('in', g.rate, Math.round((Number(g.base) || 0) + (Number(g.vat) || 0)) - Math.round(Number(g.vat) || 0));
  return C.out();
}

/** Legacy `docBases('Каса')`: the daily sales groups by rate. */
export function salesVatBases(groups: readonly { rate: number; base: number }[]): VatBase[] {
  const C = collect();
  for (const g of groups) C.add('out', g.rate, Number(g.base) || 0);
  return C.out();
}

/**
 * Legacy `vbLines`: Д `vb<t><r>d` / П `vb<t><r>p` per base (a negative base on the opposite sides, or with minus on the
 * same sides when credit notes are booked as red storno — `storno`).
 */
export function vbLines(bases: readonly VatBase[], ctx: PostingContext, storno = false): JournalLine[] {
  const out: JournalLine[] = [];
  for (const x of bases) {
    if (!x.r || !x.b) continue;
    const kd = schemeValue(ctx, `vb${x.t}${x.r}d`), kp = schemeValue(ctx, `vb${x.t}${x.r}p`);
    if (!kd || !kp || kd === '-' || kp === '-') continue;
    const note = vbNote(x.t, x.r);
    if (x.b < 0 && storno) { out.push({ account: kd, debit: x.b, credit: 0, note }, { account: kp, debit: 0, credit: x.b, note }); continue; }
    const b = Math.abs(x.b);
    out.push(x.b > 0 ? { account: kd, debit: b, credit: 0, note } : { account: kd, debit: 0, credit: b, note }, x.b > 0 ? { account: kp, debit: 0, credit: b, note } : { account: kp, debit: b, credit: 0, note });
  }
  return out;
}

/** Ledger line as the control card reads it. */
export interface VbLedgerLine { account: string; debit: number; credit: number; note?: string | null }

/**
 * Legacy `vbCheckHTML` 3532: the ДДВ-04 fields against the bases booked on the 994… lines of the period (Д − П of the
 * `d` konto, recognised by the base-line note). `F` = ДДВ-04 fields, `inByRate` = input bases by rate of the period.
 * Rows: [field, label, ДДВ-04, booked, sub-row]; `null` when nothing is booked (legacy shows no card).
 */
export function vbControl(lines: readonly VbLedgerLine[], ctx: PostingContext, F: Readonly<Record<string, number>>, inByRate: Readonly<Record<number, number>>):
  { rows: { k: string; t: string; f: number; v: number; sub: boolean }[]; ok: boolean } | null {
  const L: { t: VatBaseType; r: number; a: number }[] = [];
  for (const l of lines) {
    const m = String(l.note ?? '').match(/^Основица ДДВ (излез|влез|увоз) (\d+)%$/);
    if (!m) continue;
    const t = (Object.entries(VB_N).find(([, n]) => n === m[1])![0]) as VatBaseType, r = +m[2]!;
    if (String(l.account) !== schemeValue(ctx, `vb${t}${r}d`)) continue;
    L.push({ t, r, a: (Number(l.debit) || 0) - (Number(l.credit) || 0) });
  }
  if (!L.length) return null;
  const sum = (t: VatBaseType, r?: number) => Math.round(L.filter((x) => x.t === t && (!r || x.r === r)).reduce((s, x) => s + x.a, 0));
  const rows = [
    { k: '01', t: 'Излезен промет 18%', f: F['01'] ?? 0, v: sum('out', 18), sub: false },
    { k: '03', t: 'Излезен промет 10%', f: F['03'] ?? 0, v: sum('out', 10), sub: false },
    { k: '05', t: 'Излезен промет 5%', f: F['05'] ?? 0, v: sum('out', 5), sub: false },
    { k: '21', t: 'Влезен промет – вкупно (сите стапки)', f: F['21'] ?? 0, v: sum('in'), sub: false },
    ...[18, 10, 5].map((r) => ({ k: '21·' + r + '%', t: 'од тоа со ' + r + '%', f: Math.round(inByRate[r] ?? 0), v: sum('in', r), sub: true })),
    { k: '27', t: 'Увоз – вкупно', f: F['27'] ?? 0, v: sum('imp'), sub: false },
    ...[18, 10, 5].filter((r) => sum('imp', r)).map((r) => ({ k: '27·' + r + '%', t: 'од тоа со ' + r + '%', f: sum('imp', r), v: sum('imp', r), sub: true })),
  ].map((x) => ({ ...x, f: Math.round(x.f) }));
  return { rows, ok: rows.every((x) => Math.abs(x.f - x.v) <= 2) };
}
