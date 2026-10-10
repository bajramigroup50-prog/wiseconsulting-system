/**
 * МПИН од УЈП — accepted payroll declarations („Декларација за прием“) for all firms at once
 * (legacy v451–v453, `VIEWS.mpinIn` 14074 + patches 14106–14171).
 *
 * Pure part: normalise what the model read (`mpinNorm` + the v453 wrapper), find the firm by ЕДБ / name
 * (`mpinFirmOf`), the row warnings (`mpinRowState`), the "what will happen" text (`mpinWhat`) and the journal
 * lines booked when the payroll was not calculated in the program (`mpinLinesFor`).
 *
 * DELIBERATE FIXES
 * - FIX(#1) `mpinLinesFor` takes the resolved payroll scheme (`PayScheme`) instead of switching the global firm.
 * - FIX(#2) the "same gross" check uses whole denars like legacy (|Δ| ≤ 1) but never treats a missing run as 0.
 */
import { r2 } from '../money';
import type { PayJournalLine, PayScheme, PaySchKey } from '../payroll/entries';

/** Digits only (legacy `edbD`). */
export const edbD = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

export interface MpinFirm { id: string; name: string; edb?: string | null }

/** Legacy `mpinFirmOf`: ЕДБ (≥ 7 digits, suffix match either way), else the name without the legal form (≥ 4 chars). */
export function mpinFirmOf<F extends MpinFirm>(firms: readonly F[], edb: unknown, name: unknown): F | null {
  const e = edbD(edb);
  if (e.length >= 7) {
    const x = firms.find((f) => { const fe = edbD(f.edb); return fe.length >= 7 && (fe === e || fe.endsWith(e) || e.endsWith(fe)); });
    if (x) return x;
  }
  const nn = (s: unknown) => String(s ?? '').toUpperCase().replace(/ДООЕЛ|ДОО|ДПТУ|ДППУ|ТП\b|АД\b|DOOEL|DOO/g, '').replace(/[^A-ZА-ЯЃЌЉЊЏЅЈ0-9]/g, '');
  const n = nn(name);
  if (n.length < 4) return null;
  return firms.find((f) => { const m = nn(f.name); return m.length >= 4 && (m.includes(n) || n.includes(m)); }) ?? null;
}

/** Legacy `mpinNum`: „165,529.00“, „165.529,00“, numbers. */
export function mpinNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').replace(/\s/g, '');
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return +s || 0;
}

/** One normalised declaration (legacy `M`). Amounts in denars; dates `YYYY-MM-DD`; `period` `YYYY-MM`. */
export interface MpinRead {
  isMpin: boolean;
  edb: string;
  name: string;
  period: string;
  status: string;
  subNo: string;
  subDate: string;
  due: string;
  folio: string;
  insured: number;
  gross: number; pio: number; zdr: number; dop: number; vrab: number; staz: number; tax: number; total: number;
  /** total − sum of the columns (legacy `diff`). */
  diff: number;
  /** gross − contributions − tax. */
  net: number;
  /** How it was read: AI, manual (`рачно`). */
  how?: string;
}

const AMT = ['gross', 'pio', 'zdr', 'dop', 'vrab', 'staz', 'tax', 'total'] as const;

/** Legacy `mpinNorm` with the v453 wrapper (array / `{declaration}` answers, `isMpin:false` with data → true). */
export function mpinNorm(r0: unknown): MpinRead {
  let r = r0 as Record<string, unknown> | unknown[] | null | undefined;
  if (Array.isArray(r)) r = (r[0] as Record<string, unknown>) ?? {};
  let o = (r ?? {}) as Record<string, unknown>;
  if (o.declaration && typeof o.declaration === 'object') o = o.declaration as Record<string, unknown>;
  const s = (k: string) => String(o[k] ?? '').trim();
  const M: MpinRead = {
    isMpin: o.isMpin !== false, edb: edbD(o.edb), name: s('name'), period: s('period'), status: s('status'), subNo: s('subNo'),
    subDate: String(o.subDate ?? '').slice(0, 10), due: String(o.due ?? '').slice(0, 10), folio: s('folio'), insured: +(o.insured as number) || 0,
    gross: 0, pio: 0, zdr: 0, dop: 0, vrab: 0, staz: 0, tax: 0, total: 0, diff: 0, net: 0,
  };
  for (const k of AMT) M[k] = r2(mpinNum(o[k]));
  const m = /^(\d{1,2})[/.-](\d{4})$/.exec(M.period);
  if (m) M.period = `${m[2]}-${m[1]!.padStart(2, '0')}`;
  const m2 = /^(\d{4})[/.-](\d{1,2})/.exec(M.period);
  if (m2) M.period = `${m2[1]}-${m2[2]!.padStart(2, '0')}`;
  const dd = (v: string) => { const x = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(v); return x ? `${x[3]}-${x[2]!.padStart(2, '0')}-${x[1]!.padStart(2, '0')}` : v; };
  M.subDate = dd(M.subDate);
  M.due = dd(M.due);
  const sum = r2(M.pio + M.zdr + M.dop + M.vrab + M.staz + M.tax);
  if (!M.total) M.total = sum;
  M.diff = r2(M.total - sum);
  M.net = r2(M.gross - sum);
  if (M.isMpin === false && (M.period || M.gross)) M.isMpin = true;
  return M;
}

/** Legacy `mpinOkM`: something usable was read. */
export const mpinOk = (M: Partial<MpinRead> | null | undefined): boolean => !!(M && (M.period || M.gross));
export const mpinPeriodOk = (p: unknown): p is string => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

/** Manual entry fields (legacy `MPIN_F`). */
export const MPIN_F: readonly (readonly [keyof MpinRead, string])[] = [
  ['period', 'Период (ММ/ГГГГ)'], ['edb', 'ЕДБ на обврзникот'], ['name', 'Име на обврзникот'], ['subNo', 'Број за поднесување'],
  ['subDate', 'Датум на поднесување'], ['status', 'Статус'], ['gross', 'Бруто основица'], ['pio', 'ПИО'], ['zdr', 'Здравство'],
  ['dop', 'Доп. придонес 0,5%'], ['vrab', 'Невработеност'], ['staz', 'Стаж со зголемено траење'], ['tax', 'Персонален данок'],
  ['due', 'Рок за плаќање'], ['folio', 'Фолио (бр. на налог)'],
];

/** Last day of `YYYY-MM` (legacy `mpinLastDay`). */
export function mpinLastDay(mo: string): string {
  const [y, m] = mo.split('-').map(Number) as [number, number];
  return `${mo}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** `MM/YYYY` label. */
export const mpinPer = (mo: string): string => `${mo.slice(5)}/${mo.slice(0, 4)}`;

/**
 * Journal lines from a declaration (legacy `mpinLinesFor` 14059): credits per fund (ПИО incl. стаж), PIT and net,
 * optional `pay_via` pair, optional employer-expense split, debit gross; same account + side merged (notes kept apart).
 */
export function mpinLinesFor(M: Pick<MpinRead, 'gross' | 'pio' | 'zdr' | 'dop' | 'vrab' | 'staz' | 'tax' | 'net'>, scheme: PayScheme): PayJournalLine[] {
  const on = (k: PaySchKey) => !!scheme[k] && scheme[k] !== '-';
  type L = { k: string; d: number; p: number; note?: string };
  const pio = r2(M.pio + M.staz);
  const E0: L[] = ([['pay_eTax', M.tax], ['pay_ePio', pio], ['pay_eZdr', M.zdr], ['pay_eDop', M.dop], ['pay_eVrab', M.vrab]] as const)
    .filter(([k]) => on(k)).map(([k, v]) => ({ k: scheme[k], d: r2(v), p: 0 }));
  const split = E0.reduce((a, l) => a + l.d, 0);
  const via: L[] = on('pay_via') ? [{ k: scheme.pay_via, d: 0, p: M.gross, note: 'Бруто плата' }, { k: scheme.pay_via, d: M.gross, p: 0, note: 'Распоред на бруто плата' }] : [];
  const L0: L[] = [
    ...([['pay_pio', pio], ['pay_zdr', M.zdr], ['pay_dop', M.dop], ['pay_vrab', M.vrab], ['pay_tax', M.tax]] as const)
      .map(([k, v]): L => ({ k: on(k) ? scheme[k] : scheme.pay_contrib, d: 0, p: r2(v) })),
    { k: scheme.pay_net, d: 0, p: M.net, note: 'Нето плата за исплата' },
    ...via, ...E0,
    { k: scheme.pay_gross, d: r2(M.gross - split), p: 0 },
  ];
  const A: L[] = [];
  for (const l of L0) {
    const x = A.find((y) => y.k === l.k && !!y.d === !!l.d && !l.note && !y.note);
    if (x) { x.d = r2(x.d + l.d); x.p = r2(x.p + l.p); } else A.push({ ...l });
  }
  return A.filter((l) => l.d || l.p).map((l) => ({ account: l.k, debit: l.d, credit: l.p, ...(l.note ? { note: l.note } : {}) }));
}

/** Row states (legacy `r.stat`). */
export type MpinStat = 'queued' | 'reading' | 'ok' | 'notm' | 'error' | 'done';

/** Warnings of a read row that is ready (legacy `mpinRowState` `w[]`); empty = „Подготвено“. */
export function mpinWarnings(M: Partial<MpinRead> | null | undefined, firmId: string | null | undefined): string[] {
  const w: string[] = [];
  if (!firmId) w.push('изберете фирма');
  if (!mpinPeriodOk(M?.period)) w.push('нема период');
  if (M?.status && !/ПРИФАТ/i.test(M.status)) w.push('статус: ' + M.status);
  if (Math.abs(M?.diff ?? 0) > 1) w.push(`вкупно ≠ збир (${(M?.diff ?? 0).toFixed(2)})`);
  return w;
}

/** Distributable: read, firm chosen, valid period (legacy `ready`). */
export const mpinReady = (r: { stat: MpinStat; firmId?: string | null; M?: Partial<MpinRead> | null }): boolean =>
  r.stat === 'ok' && !!r.firmId && mpinPeriodOk(r.M?.period);

/** What the distribution will do for the row (legacy `mpinWhat` + the v452 correction prefix), plain text. */
export interface MpinPlan {
  /** Payroll run of the month (gross incl. supplements). */
  run: { gross: number } | null;
  /** A `mpin` journal of the month already exists. */
  journal: boolean;
  /** Active acceptance of the month already stored (correction). */
  old: { no: string | null; date: string | null } | null;
  book: boolean;
}
export function mpinWhat(M: Pick<MpinRead, 'gross'>, p: MpinPlan): { corr: string | null; text: string; warn: boolean } {
  const corr = p.old ? `Корекција: за овој месец веќе има МПИН бр. ${p.old.no ?? ''}${p.old.date ? ' од ' + p.old.date.split('-').reverse().join('.') : ''} – стариот ќе се замени (PDF-от останува во досие како „заменет“).` : null;
  if (p.run) {
    return Math.abs(p.run.gross - M.gross) <= 1
      ? { corr, text: 'Плата пресметана во програмот – само се потврдува (✓ се совпаѓа)', warn: false }
      : { corr, text: `Плата во програмот: бруто ${p.run.gross.toFixed(2)} – МПИН ${M.gross.toFixed(2)}. Се потврдува, проверете ја разликата.`, warn: true };
  }
  if (p.journal) return { corr, text: 'Налогот од МПИН за овој месец веќе постои – ќе се замени.', warn: false };
  return { corr, text: p.book ? 'Нема пресметка во програмот → се отвора налог од МПИН' : 'Само во досие (без налог)', warn: false };
}

/** Dossier note of the stored declaration (legacy `docs/mpin-{month}.note`). */
export function mpinNote(M: MpinRead, fmt: (n: number) => string = (n) => n.toFixed(2)): string {
  return (M.status ? M.status + ' · ' : '') + 'бруто ' + fmt(M.gross) + ' · придонеси и данок ' + fmt(M.total)
    + (M.due ? ' · рок ' + M.due.split('-').reverse().join('.') : '') + (M.folio ? ' · фолио ' + M.folio : '');
}
