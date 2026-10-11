/**
 * Finance parity — opening balance (почетна состојба): AI read mapping, difference analysis, bank rows.
 * Pure, unit-tested (`finpar-ob.test.ts`).
 */
import { r2 } from './money';

type ObRowT = [string, string, string, string, number, number];
const obDig = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/**
 * Legacy `obAi` 10646 result mapping (+ `obNetZero` 12378 and the 951/961 → 950/960 wrapper 12390):
 * `{rows:[[konto,name,partner,code,saldoD,saldoP]], totals:[[konto,d,p]], grand:[d,p]}` → parsed sheet rows.
 * Rows without a konto belong to the previous konto. Kontos whose partner lines net to 0 are dropped (reported
 * in `netZero`). Outside full mode 951/961 are carried as 950/960 (one row each, netted).
 */
export function obFromAi(res: unknown, o: { full?: boolean } = {}): {
  rows: ObRowT[]; totals: [string, number, number][]; grand: [number, number]; netZero: { k: string; n: number; g: number }[]; remapped: number;
} {
  const r = (Array.isArray(res) ? { rows: res } : (res ?? {})) as { rows?: unknown[]; totals?: unknown[]; grand?: unknown };
  let rows: ObRowT[] = [];
  let lastK = '';
  for (const x of r.rows ?? []) {
    const a = Array.isArray(x) ? x : (() => { const o2 = (x ?? {}) as Record<string, unknown>; return [o2.konto, o2.name, o2.partner, o2.code, o2.saldoDebit, o2.saldoCredit]; })();
    const k = obDig(a[0]) || lastK;
    if (!/^\d{3,8}$/.test(k)) continue;
    rows.push([k, String(a[1] ?? ''), String(a[2] ?? ''), String(a[3] ?? ''), r2(+(a[4] as number) || 0), r2(+(a[5] as number) || 0)]);
    lastK = k;
  }
  const totals: [string, number, number][] = [];
  for (const t of r.totals ?? []) {
    const a = Array.isArray(t) ? t : (() => { const o2 = (t ?? {}) as Record<string, unknown>; return [o2.konto, o2.debit, o2.credit]; })();
    if (obDig(a[0])) totals.push([obDig(a[0]), +(a[1] as number) || 0, +(a[2] as number) || 0]);
  }
  const g = Array.isArray(r.grand) ? r.grand as unknown[] : [];
  const grand: [number, number] = [+(g[0] as number) || 0, +(g[1] as number) || 0];
  // obNetZero
  const by: Record<string, ObRowT[]> = {};
  for (const x of rows) (by[x[0]] ??= []).push(x);
  const drop = new Set<ObRowT>();
  const netZero: { k: string; n: number; g: number }[] = [];
  for (const [k, L] of Object.entries(by)) {
    if (L.length < 2 || (o.full && /^[478]/.test(k))) continue;
    const net = L.reduce((s, x) => s + x[4] - x[5], 0), gd = L.reduce((s, x) => s + x[4], 0);
    if (Math.abs(net) < 0.5 && gd > 0.5) { L.forEach((x) => drop.add(x)); netZero.push({ k, n: L.length, g: r2(gd) }); }
  }
  rows = rows.filter((x) => !drop.has(x));
  // 951 → 950, 961 → 960 (not in full mode)
  let remapped = 0;
  if (!o.full) {
    const M: Record<string, ObRowT> = {};
    const out: ObRowT[] = [];
    for (const x0 of rows) {
      let x = x0;
      if (/^9[56]1/.test(x[0])) { remapped++; x = [x[0].startsWith('95') ? '950' : '960', '', x[2], x[3], x[4], x[5]]; }
      if (/^9[56]0$/.test(x[0]) && !x[2]) {
        const m = M[x[0]];
        if (m) { const net = r2(m[4] - m[5] + x[4] - x[5]); m[4] = net > 0 ? net : 0; m[5] = net < 0 ? -net : 0; continue; }
        x = [...x] as ObRowT; M[x[0]] = x;
      }
      out.push(x);
    }
    rows = out;
  }
  return { rows, totals, grand, netZero, remapped };
}

export interface ObDiagRow { i: number; account: string; label: string; debit: number; credit: number; partner: string }
export interface ObDiag {
  D: number; P: number; diff: number; res: number;
  cls: { c: number; n: number; d: number; p: number }[];
  hits: { r: ObDiagRow; why: string }[];
  dup: ObDiagRow[][];
  both: ObDiagRow[];
  noK: ObDiagRow[];
  ctl: { k: string; net: number; doc: number }[];
  pairs: [ObDiagRow, ObDiagRow][];
  pay: ObDiagRow[];
  sub: { r: ObDiagRow; why: string }[];
}

/**
 * Legacy „🔍 Анализа на разликата“ (`obDiag` 12280, pairs/pay 12314, `obSubtot` 12338): why an opening balance does
 * not balance. `known(k)` = konto exists; `printed` = printed totals per konto from the read.
 */
export function obDiag(R: readonly ObDiagRow[], o: { known: (k: string) => boolean; printed?: readonly { k: string; doc: number | null }[] }): ObDiag {
  const L = R.filter((r) => r.account && (r.debit || r.credit));
  const D = r2(L.reduce((s, r) => s + r.debit, 0)), P = r2(L.reduce((s, r) => s + r.credit, 0)), diff = r2(D - P);
  const cls: ObDiag['cls'] = [];
  for (let c = 0; c <= 9; c++) {
    const X = L.filter((r) => r.account[0] === String(c));
    if (X.length) cls.push({ c, n: X.length, d: r2(X.reduce((s, r) => s + r.debit, 0)), p: r2(X.reduce((s, r) => s + r.credit, 0)) });
  }
  const ad = Math.abs(diff);
  const near = (v: number) => Math.abs(v - ad) < 0.5;
  const hits: ObDiag['hits'] = [];
  if (ad > 0.005) {
    for (const r of L) {
      const v = r.debit || r.credit;
      if (near(v) || near(v * 2) || Math.abs(v - ad / 2) < 0.5) {
        hits.push({ r, why: near(v) ? 'износот е еднаков на разликата' : Math.abs(v - ad / 2) < 0.5 ? 'двапати овој износ = разликата (можеби е на погрешна страна Д/П)' : 'половина од разликата' });
      }
    }
  }
  const seen = new Map<string, ObDiagRow[]>();
  for (const r of L) { const key = `${r.account}|${r.partner}|${r.debit}|${r.credit}`; seen.set(key, [...(seen.get(key) ?? []), r]); }
  const dup = [...seen.values()].filter((g) => g.length > 1);
  const noK = L.filter((r) => !o.known(r.account) && !o.known(r.account.slice(0, 3)));
  const both = L.filter((r) => r.debit && r.credit);
  const ctl: ObDiag['ctl'] = [];
  for (const x of o.printed ?? []) {
    if (x.doc == null) continue;
    const net = r2(L.filter((r) => r.account === x.k).reduce((s, r) => s + r.debit - r.credit, 0));
    if (Math.abs(net - x.doc) > 0.5) ctl.push({ k: x.k, net, doc: x.doc });
  }
  const res = r2(L.filter((r) => /^[4-8]/.test(r.account)).reduce((s, r) => s + r.debit - r.credit, 0));
  const pairs: [ObDiagRow, ObDiagRow][] = [];
  if (ad > 0.5) {
    const map = new Map<number, ObDiagRow>();
    for (const r of L) {
      const k = Math.round((r.debit || r.credit) * 100), need = Math.round(ad * 100) - k;
      if (map.has(need)) pairs.push([map.get(need)!, r]);
      if (!map.has(k)) map.set(k, r);
      if (pairs.length >= 8) break;
    }
  }
  const pay = L.filter((r) => /^(24|42|41)/.test(r.account));
  const net = (r: ObDiagRow) => r2(r.debit - r.credit);
  const sub: ObDiag['sub'] = [];
  const used = new Set<number>();
  for (const r of L) {
    if (used.has(r.i)) continue;
    if (/вкупно|збир|синтетик|total/i.test(r.label)) { sub.push({ r, why: 'во називот пишува „вкупно/збир“' }); used.add(r.i); continue; }
    if (r.partner) continue;
    const same = L.filter((x) => x.i !== r.i && x.account === r.account && x.partner);
    if (same.length >= 2 && Math.abs(net(r) - r2(same.reduce((s, x) => s + net(x), 0))) < 1) { sub.push({ r, why: `= збир на ${same.length} ставки по партнери на истото конто` }); used.add(r.i); continue; }
    const kids = L.filter((x) => x.i !== r.i && x.account.length > r.account.length && x.account.startsWith(r.account));
    if (kids.length >= 1 && Math.abs(net(r) - r2(kids.reduce((s, x) => s + net(x), 0))) < 1) {
      sub.push({ r, why: '= збир на подконтата ' + [...new Set(kids.map((x) => x.account))].slice(0, 5).join(', ') }); used.add(r.i);
    }
  }
  return { D, P, diff, res, cls, hits, dup, both, noK, ctl, pairs, pay, sub };
}

/** Legacy `obBankRows` 12219: bank / FX accounts (100x, 103x) of the opening balance the firm has no bank account for. */
export function obBankRows<R extends { account: string }>(rows: readonly R[], haveKontos: readonly string[]): R[] {
  const have = new Set(haveKontos.map(String));
  const seen = new Set<string>();
  return rows.filter((r) => /^10[03]\d*$/.test(r.account) && r.account !== '100' && r.account !== '103' && !have.has(r.account) && !seen.has(r.account) && !!seen.add(r.account));
}
