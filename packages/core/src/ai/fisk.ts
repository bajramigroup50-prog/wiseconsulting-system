/**
 * Fiscal report read with `FISK_PROMPT` (and the `FK_SIMPLE` second attempt) → rows for the fiscal-report editor.
 * Port of legacy `FISK_G0`, `fkN`, `fkNormDate`, `fkRows` (11343–11350), `fkFix` (12991), `FK_LAT`, `fkFromText`,
 * `fkApplyText` (13014–13027), `fkNoVatEvid` (13115) and the post-read steps of the `ACT.fkRead` wrappers
 * (12995, 13028, 13035, 13116), in the order the wrappers ran.
 *
 * Not ported: splitting a long receipt photo into tiles (`fkTiles`), the PDF text layer and the Tesseract OCR fallback
 * — the model reads the whole PDF / image.
 */
import { r2 } from '../money';

/** Default tax-group letters → VAT rate (legacy `FISK_G0`). */
export const FISK_G0: Readonly<Record<string, number>> = { А: 18, Б: 5, В: 0, Г: 10 };
/** Latin look-alikes of the group letters (legacy `FK_LAT`). */
export const FK_LAT: Readonly<Record<string, string>> = { A: 'А', B: 'Б', V: 'В', G: 'Г', Б: 'Б', В: 'В', Г: 'Г', А: 'А' };

/** Legacy `fkN`: amount as printed by a fiscal printer (spaces / dots / commas as thousands separators). */
export function fkN(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? r2(v) : 0;
  let t = String(v ?? '').replace(/[\s  ']/g, '').replace(/[^\d.,-]/g, '');
  if (!t) return 0;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc > -1 && ld > -1) t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (lc > -1) t = /,\d{1,2}$/.test(t) && (t.match(/,/g) || []).length === 1 ? t.replace(',', '.') : t.replace(/,/g, '');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  const x = parseFloat(t);
  return isFinite(x) ? r2(x) : 0;
}

/** Legacy `fkNormDate`: d.m.yyyy / d-m-yyyy / ISO → ISO ('' when not a date). */
export function fkNormDate(v: unknown): string {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  return m ? m[3] + '-' + m[2]!.padStart(2, '0') + '-' + m[1]!.padStart(2, '0') : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

type Amt = number | string | null | undefined;
export interface FiskReadDay {
  date?: string; z?: string; gross?: Record<string, Amt>; vat?: Record<string, Amt>;
  total?: Amt; cash?: Amt; card?: Amt; other?: Amt; storno?: Amt; receipts?: Amt;
}
/** The `FISK_PROMPT` reply, normalised in place by the functions below. */
export interface FiskRead {
  device?: string; edb?: string; from?: string; to?: string; zFrom?: string; zTo?: string;
  groups?: Record<string, Amt>; days?: FiskReadDay[]; totals?: FiskReadDay; text?: string; text2?: string;
  /** No VAT on the report (firm outside the VAT system) — legacy `S.fk.nonVat`. */
  nonVat?: boolean;
}

export interface FiskRow {
  date: string; z: string; gross: Record<string, number>; vat: Record<string, number>;
  total: number; sum: number; cash: number; card: number; other: number; storno: number; receipts: number;
}

/** Legacy `fkRows`: daily rows when the report lists days, else one row with the period totals dated `to`. */
export function fkRows(R: FiskRead, today: string): { G: Record<string, number>; rows: FiskRow[]; daily: boolean } {
  const G: Record<string, number> = { ...FISK_G0 };
  for (const [k, v] of Object.entries(R.groups ?? {})) G[k] = v as number;
  const days = (R.days ?? []).filter((d) => fkNormDate(d.date) && (fkN(d.total) || Object.values(d.gross ?? {}).some((x) => +(x as number))));
  const mk = (d: FiskReadDay, date: string): FiskRow => {
    const gross: Record<string, number> = {}, vat: Record<string, number> = {};
    let sum = 0;
    for (const L of Object.keys(G)) {
      const g = fkN((d.gross ?? {})[L]);
      if (!g) continue;
      gross[L] = g;
      sum = r2(sum + g);
      const rate = +(G[L] as number) || 0;
      const v = (d.vat ?? {})[L];
      vat[L] = v != null && +(v as number) ? fkN(v) : rate ? r2((g * rate) / (100 + rate)) : 0;
    }
    return { date, z: String(d.z || ''), gross, vat, total: fkN(d.total) || sum, sum, cash: fkN(d.cash), card: fkN(d.card), other: fkN(d.other), storno: fkN(d.storno), receipts: +(d.receipts ?? 0) || 0 };
  };
  if (days.length) return { G, rows: days.map((d) => mk(d, fkNormDate(d.date))), daily: true };
  return { G, rows: [mk(R.totals ?? {}, fkNormDate(R.to) || today)], daily: false };
}

/** Total turnover of a read (legacy `fkRows(R).rows.reduce(total)`). */
export const fiskReadTotal = (R: FiskRead, today = '2000-01-01'): number => r2(fkRows(R, today).rows.reduce((a, r) => a + r.total, 0));

/** Legacy `fkFix`: amounts as numbers, total from the groups, the whole total in one group, cash = total when no payments. */
export function fkFix(R: FiskRead): FiskRead {
  if (!R) return R;
  const fx = (d: FiskReadDay | undefined) => {
    if (!d) return;
    d.gross = d.gross || {};
    for (const L of Object.keys(d.gross)) d.gross[L] = fkN(d.gross[L]);
    if (d.vat) for (const L of Object.keys(d.vat)) d.vat[L] = fkN(d.vat[L]);
    for (const k of ['total', 'cash', 'card', 'other', 'storno'] as const) d[k] = fkN(d[k]);
    const sum = r2(Object.values(d.gross).reduce<number>((a, x) => a + (x as number), 0));
    if (!d.total) d.total = sum;
    if (!sum && d.total) {
      d.gross = { Г: 0, А: 0, ...d.gross };
      const L = Object.keys(R.groups || {}).find((x) => +(R.groups![x] as number) >= 0) || 'А';
      d.gross[L] = d.total;
    }
    const cash = d.cash as number, card = d.card as number, other = d.other as number, total = d.total as number;
    const pay = r2(cash + card + other);
    if (!pay) d.cash = total;
    else if (Math.abs(pay - total) > 1 && !cash && card < total * 0.01) { d.card = 0; d.other = 0; d.cash = total; }
  };
  fx(R.totals);
  (R.days || []).forEach(fx);
  if (R.device && R.zTo && String(R.device).replace(/^0+/, '') === String(R.zTo).replace(/^0+/, '')) R.device = '';
  return R;
}

export interface FiskText {
  total: number; gross: Record<string, number>; storno: number; cash: number; card: number; receipts: number;
  device: string; edb: string; from: string; to: string; zFrom: string; zTo: string; noVat: boolean;
}

/** Legacy `fkFromText`: totals from the transcribed report text (null when there is no text). */
export function fkFromText(t0: unknown): FiskText | null {
  const t = String(t0 || '').toUpperCase().replace(/[ \t]+/g, ' ');
  if (t.replace(/\s/g, '').length < 20) return null;
  const num = (x: unknown) => fkN(String(x).trim());
  const AM = '(-?\\d{1,3}(?:[ .,]\\d{3})*(?:[.,]\\d{2})|-?\\d+(?:[.,]\\d{2})?)';
  const cut = t.search(/СТОРН[ОИ]\s+СМЕТК/);
  const main = cut > 0 ? t.slice(0, cut) : t, sto = cut > 0 ? t.slice(cut) : '';
  const tots = [...main.matchAll(new RegExp('ВКУПЕН\\s+ПРОМЕТ\\s*:?\\s*' + AM, 'g'))].map((m) => num(m[1]));
  const gross: Record<string, number> = {};
  for (const m of main.matchAll(new RegExp('ПРОМЕТ\\s+([АБВГABVG])(?=[\\s:])\\s*:?\\s*' + AM, 'g'))) {
    const L = FK_LAT[m[1]!] || m[1]!;
    gross[L] = Math.max(gross[L] || 0, num(m[2]));
  }
  const total = Math.max(0, ...tots, Object.values(gross).reduce((a, x) => a + x, 0));
  const sTot = Math.max(0, ...[...sto.matchAll(new RegExp('ВКУПЕН\\s+ПРОМЕТ\\s*:?\\s*' + AM, 'g'))].map((m) => num(m[1])));
  const g = (re: RegExp) => { const m = t.match(re); return m ? m[1]! : ''; };
  const per = t.match(/ОД\s*:?\s*(\d{2}[-./]\d{2}[-./]\d{4})\s*ДО\s*:?\s*(\d{2}[-./]\d{2}[-./]\d{4})/);
  const zr = t.match(/ОД\s*:?\s*(\d{1,6})\s*ДО\s*:?\s*(\d{1,6})(?!\s*[-./]\d)/);
  const cash = num(g(new RegExp('ГОТОВИНА\\s*:?\\s*' + AM)) || 0), card = num(g(new RegExp('КАРТИЧ\\w*\\s*:?\\s*' + AM)) || 0);
  return {
    total, gross, storno: sTot, cash, card, receipts: +g(/БРОЈ\s+ФИСК\.?\s*СМЕТКИ\s*:?\s*(\d+)/) || 0,
    device: g(/(?:РЕГ\.?\s*БРОЈ|БР\.?\s*НА\s*ФМ)\s*:?\s*([A-ZА-Ш]{1,3}\d{5,})/), edb: g(/(?:ДАН\.?\s*БРОЈ|ЕДБ)\s*:?\s*(\d{13})/),
    from: per ? per[1]! : '', to: per ? per[2]! : '', zFrom: zr ? zr[1]! : '', zTo: zr ? zr[2]! : '',
    noVat: !/ДДВ\s*БРОЈ\s*:?\s*[A-ZА-Ш]{0,3}\d{5,}/.test(t) && ![...t.matchAll(new RegExp('ДДВ\\s+(?:ИЗНОС|[АБВГ])\\s*:?\\s*' + AM, 'g'))].some((m) => num(m[1]) > 0),
  };
}

/** Legacy `fkApplyText`: replace the period totals with the ones from the text when the read gave none / different. */
export function fkApplyText(R: FiskRead, P: Partial<FiskText> | null | undefined): boolean {
  if (!R || !P || !((P.total ?? 0) > 0)) return false;
  const T = (R.totals = R.totals || {});
  const cur = fkN(T.total) || Object.values(T.gross || {}).reduce<number>((a, x) => a + fkN(x), 0);
  if (cur > 0 && !(R.days || []).length && Math.abs(cur - P.total!) < 1) return false;
  if ((R.days || []).length && cur > 0) return false;
  R.days = [];
  const pg = P.gross ?? {};
  const L = Object.keys(pg)[0] || Object.keys(R.groups || {})[0] || 'А';
  T.gross = Object.keys(pg).length ? { ...pg } : { [L]: P.total };
  T.total = P.total;
  T.cash = P.cash || 0; T.card = P.card || 0; T.other = 0; T.storno = P.storno || 0; T.receipts = P.receipts || T.receipts || 0;
  T.vat = {};
  for (const k of ['device', 'edb', 'from', 'to', 'zFrom', 'zTo'] as const) if (P[k]) R[k] = P[k];
  return true;
}

/** Legacy `fkNoVatEvid`: every turnover group has a printed VAT of 0 → firm outside the VAT system. */
export function fkNoVatEvid(R: FiskRead): boolean {
  const T = (R && R.totals) || {};
  let has = false;
  for (const d of [T, ...((R && R.days) || [])]) {
    for (const [L, g] of Object.entries(d.gross || {})) {
      if (!(fkN(g) > 0)) continue;
      const v = (d.vat || {})[L];
      if (v == null || v === '') return false;
      if (fkN(v) > 0) return false;
      has = true;
    }
  }
  return has;
}

/**
 * The first read as legacy `fkRead` stored it (array → `{days}`, duplicate days from overlapping pages once) followed
 * by the `fkFix` and report-text steps (wrappers 12995, 13028). Returns the normalised read.
 */
export function fiskAfterRead(r0: unknown): FiskRead {
  const r = (Array.isArray(r0) ? { days: r0 } : r0 && typeof r0 === 'object' ? r0 : {}) as FiskRead;
  const R: FiskRead = { ...r, days: [...(r.days || [])], totals: r.totals || { gross: {}, vat: {} }, groups: { ...(r.groups || {}) }, text: typeof r.text === 'string' ? r.text : '' };
  const seen = new Set<string>();
  R.days = R.days!.filter((d) => { const k = fkNormDate(d.date) + '|' + (d.z || '') + '|' + d.total; if (seen.has(k)) return false; seen.add(k); return true; });
  fkFix(R);
  const P = fkFromText(R.text);
  if (P && P.device) R.device = P.device;
  if (P && P.noVat && P.total > 0) R.nonVat = true;
  fkApplyText(R, P);
  fkFix(R);
  return R;
}

/** The `FK_SIMPLE` reply (second attempt, total only). */
export interface FiskSimple {
  total?: Amt; group?: string; vatTotal?: Amt; from?: string; to?: string; zFrom?: string; zTo?: string;
  device?: string; edb?: string; receipts?: Amt; storno?: Amt; text?: string;
}

/** Legacy wrapper 13035: merge the `FK_SIMPLE` reply into a read whose total was 0. */
export function fiskApplySimple(R: FiskRead, r0: unknown): FiskRead {
  const r = ((Array.isArray(r0) ? r0[0] : r0) || {}) as FiskSimple;
  R.text2 = String(r.text || '');
  const P: Partial<FiskText> = fkFromText(r.text) || {};
  const total = Math.max(fkN(r.total), P.total || 0);
  if (total > 0) {
    const L = FK_LAT[String(r.group || '').toUpperCase()] || Object.keys(P.gross || {})[0] || 'Г';
    fkApplyText(R, {
      ...P, total, gross: { [L]: total }, cash: P.cash || 0, card: P.card || 0, storno: fkN(r.storno) || P.storno || 0, receipts: +(r.receipts ?? 0) || P.receipts || 0,
      device: r.device || P.device, edb: String(r.edb || P.edb || '').replace(/\D/g, ''), from: r.from || P.from, to: r.to || P.to, zFrom: r.zFrom || P.zFrom, zTo: r.zTo || P.zTo,
    });
    if (!fkN(r.vatTotal) || P.noVat) R.nonVat = true;
    fkFix(R);
  }
  return R;
}

/** Legacy wrapper 13116: drop placeholder device ids, detect a report without VAT. */
export function fiskFinish(R: FiskRead, today: string): FiskRead {
  if (/^(unknown|n\/?a|none|null|-|непознат\w*)$/i.test(String(R.device || '').trim())) R.device = '';
  if (R.nonVat == null && (fkNoVatEvid(R) || (R.text && fkFromText(R.text)?.noVat && fkRows(R, today).rows.some((x) => x.total > 0)))) R.nonVat = true;
  return R;
}

/** One report for the editor: turnover with VAT per rate (`'18' | '10' | '5' | '0'`). */
export interface FiskEditorRow { date: string; z: string; gross: Record<string, number>; total: number; card: number; cash: number; receipts: number; storno: number }

/**
 * Read → editor rows (legacy `fkRows2` without the "sum" option): daily rows or one period row; the letter groups are
 * turned into VAT rates; without VAT everything is turnover at 0 %.
 */
export function fiskEditorRows(R: FiskRead, o: { today: string; nonVat?: boolean }): { rows: FiskEditorRow[]; daily: boolean } {
  const X = fkRows(R, o.today);
  const nonVat = o.nonVat ?? !!R.nonVat;
  return {
    daily: X.daily,
    rows: X.rows.map((r) => {
      const gross: Record<string, number> = {};
      if (nonVat) gross['0'] = r.total || r.sum;
      else for (const [L, g] of Object.entries(r.gross)) { const k = String(+(X.G[L] as number) || 0); gross[k] = r2((gross[k] || 0) + g); }
      return { date: r.date, z: r.z, gross, total: r.total, card: r.card, cash: r.cash, receipts: r.receipts, storno: r.storno };
    }),
  };
}
