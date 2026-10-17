/**
 * НЛБ Банка „DpsStatement“ statement (e-banking PDF „ИЗВОД … ЗА ПРОМЕНИ НА СОСТОЈБАТА НА СРЕДСТВАТА НА СМЕТКАТА НА
 * ДЕН dd.mm.yyyy“) → grid for `readBankTable`. Its table does not fit the generic header cutting (`bankPdfGrid`): the
 * header is five lines („ред. бр. на нал.“ | „Назив и седиште на примачот / Број на сметката“ | „Депонент“ | „Износ“
 * over „Задолжување | Побарување“ | „Шифра на плаќањето“ | „Цел на дознаката“ | „повикување на број задолжување /
 * одобрување“ | „Податоци за рекламација“), and every order is a block of 2–4 lines: the ordinal centred on the block,
 * the amount on its first line, the counterparty's account on its last. The columns are taken from the positions of
 * the header words, each order is cut from the first line of its amount down to the next amount, and the balances
 * (labels „Претходна состојба | Долгува | Побарува | Нова состојба“ over their amounts) become labelled statement
 * rows — so the parser checks opening + movements = closing and the printed turnovers as for any statement.
 * The text of these PDFs is in glyph ids: the items are decoded first (`pdf-glyphs.ts`).
 */
import type { PdfItem } from './pdf-lines';
import { decodeGlyphItems } from './pdf-glyphs';
import type { BankPdfGrid } from './bank-grid';

type It = PdfItem & { t: string; x1: number };

const MONEY = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const ACC = /^\d{3}-\d{10}-\d{2}$/;
/** Reading order key: page, then top → bottom. */
const before = (a: { page: number; y: number }, b: { page: number; y: number }) => a.page < b.page || (a.page === b.page && a.y > b.y);

export interface NlbGrid extends BankPdfGrid {
  /** Orders the statement says it has („Вкупно за сметката … има 7 налози“); null when not printed. */
  count: number | null;
}

/** Grid of an НЛБ „DpsStatement“ statement, or null when the items are not that layout. */
export function nlbDpsGrid(items0: readonly PdfItem[]): NlbGrid | null {
  const I: It[] = decodeGlyphItems(items0)
    .map((it) => ({ ...it, t: it.s.replace(/\s+/g, ' ').trim(), x1: it.x + Math.max(it.w, 1) }))
    .filter((it) => it.t);
  const find = (re: RegExp, ok: (it: It) => boolean = () => true) => I.find((it) => re.test(it.t) && ok(it));
  const title = find(/за\s+промени\s+на\s+состојбата\s+на\s+средствата/i);
  const cel = find(/^цел\s+на\s+дознаката$/i);
  if (!title || !cel) return null;
  const hp = cel.page, hy = cel.y;
  const near = (it: It) => it.page === hp && Math.abs(it.y - hy) < 60;
  const dep = find(/^депонент\s+на/i, near);
  const sif = find(/^шифра\s+на/i, near);
  const nam = find(/^назив\s+и\s+седиште/i, near) ?? find(/^бр\.\s*назив\s+и\s+седиште/i, near);
  const zad = find(/^задолжување$/i, (it) => near(it) && it.y < hy && it.x < cel.x);
  const pob = find(/^побарување$/i, (it) => near(it) && it.y < hy && it.x < cel.x);
  const pov = find(/^повикување\s+на\s+број/i, near);
  const rek = find(/^податоци\s+за/i, near);
  if (!dep || !sif || !nam || !zad || !pob || !pov || !rek) return null;
  // column bands (x) from the header words
  // the bank column's values start left of its heading („Депонент на“ over „назив и седиште“)
  const depSub = I.find((it) => near(it) && it.y < dep.y && it.y > dep.y - 20 && Math.abs(it.x - dep.x) < 20);
  const nameX = nam.x - 3, depX = Math.min(dep.x, depSub?.x ?? dep.x) - 4, sifX = sif.x - 4, purpX = sif.x1, refX = pov.x - 4, rekX = rek.x - 4;
  const dcSplit = (zad.x1 + pob.x1) / 2;
  const isAmt = (it: It) => MONEY.test(it.t) && it.x1 > zad.x - 2 && it.x1 <= sifX + 6 && it.x >= depX + 40;
  // end of the table: the totals row („Вкупно денари …“) or the order count („Вкупно за сметката … има N налози“)
  const end = I.filter((it) => /^вкупно(\s+денари|\s+за\s+сметката)/i.test(it.t) && (it.page > hp || it.y < hy)).sort((a, b) => (before(a, b) ? -1 : 1))[0] ?? null;
  const inTable = (it: It) => (it.page > hp || (it.page === hp && it.y < hy - 2)) && (!end || before(it, { page: end.page, y: end.y + 2 }));
  // page labels („Страница 1 / 2“) and repeated headers are not part of an order
  const pageLab = I.filter((it) => /^страница(\s|$)/i.test(it.t));
  const onLabelRow = (it: It) => pageLab.some((p) => p.page === it.page && Math.abs(p.y - it.y) < 3);
  const T = I.filter((it) => inTable(it) && !onLabelRow(it));
  const amts = T.filter(isAmt).sort((a, b) => (before(a, b) ? -1 : 1));
  if (!amts.length) return null;
  // a later page that repeats the table header: what is above its first amount is header, not an order's tail
  const hdrPages = new Set(I.filter((it) => it.page !== hp && /^цел\s+на\s+дознаката$/i.test(it.t)).map((it) => it.page));
  const firstAmtY = new Map<number, number>();
  for (const a of amts) if (!firstAmtY.has(a.page)) firstAmtY.set(a.page, a.y);
  const blocks: It[][] = amts.map(() => []);
  for (const it of T) {
    const fy = firstAmtY.get(it.page);
    if (it.page === hp && (fy == null || it.y > fy + 2)) continue; // header lines under „Цел на дознаката“
    if (hdrPages.has(it.page) && (fy == null || it.y > fy + 2)) continue;
    let k = -1;
    amts.forEach((a, i) => { if (a.page < it.page || (a.page === it.page && a.y + 2 >= it.y)) k = i; });
    if (k >= 0) blocks[k]!.push(it);
  }
  const join = (L: It[]) => L.sort((a, b) => (a.page - b.page) || (b.y - a.y) || (a.x - b.x)).map((x) => x.t).join(' ').replace(/\s+/g, ' ').trim();
  const rows = blocks.map((B, k) => {
    const a = amts[k]!;
    const seq = B.find((it) => it.x1 <= nameX + 2 && /^\d{1,5}$/.test(it.t))?.t ?? '';
    const nameItems = B.filter((it) => it.x >= nameX && it.x < depX && !ACC.test(it.t));
    const acc = B.find((it) => it.x >= nameX && it.x < depX && ACC.test(it.t))?.t ?? '';
    const code = B.find((it) => it.x >= sifX && it.x < purpX && /^\d{1,4}$/.test(it.t))?.t ?? '';
    const purp = B.filter((it) => it.x >= purpX && it.x < refX && it !== a);
    const refs = [...new Set(B.filter((it) => it.x >= refX && it.x < rekX).sort((p, q) => (p.page - q.page) || (q.y - p.y) || (p.x - q.x)).map((x) => x.t))];
    const debit = a.x1 <= dcSplit ? a.t : '', credit = a.x1 > dcSplit ? a.t : '';
    return [seq, join(nameItems), acc, code, join(purp), refs.join(' '), debit, credit];
  });
  // statement data above the table
  const pre = I.filter((it) => it.page === hp && it.y > hy + 20);
  const text = (y: number) => pre.filter((it) => Math.abs(it.y - y) < 3).sort((a, b) => a.x - b.x).map((x) => x.t).join(' ');
  const noIt = pre.find((it) => /број\s+на\s+извод/i.test(it.t));
  const noTxt = noIt ? text(noIt.y) : '';
  const dateTxt = text(title.y);
  const accIt = pre.find((it) => ACC.test(it.t));
  const bal = (re: RegExp): string | null => {
    const L = pre.find((it) => re.test(it.t));
    if (!L) return null;
    const c = (L.x + L.x1) / 2;
    const V = pre.filter((it) => MONEY.test(it.t) && it.y < L.y && it.y > L.y - 45 && Math.abs((it.x + it.x1) / 2 - c) < 40)
      .sort((p, q) => Math.abs((p.x + p.x1) / 2 - c) - Math.abs((q.x + q.x1) / 2 - c));
    return V[0]?.t ?? null;
  };
  const open = bal(/^претходна\s+состојба$/i), close = bal(/^нова\s+состојба$/i), deb = bal(/^долгува$/i), cred = bal(/^побарува$/i);
  const all = I.map((it) => it.t).join(' ');
  const cnt = /вкупно\s+за\s+сметката.*?има\s+(\d{1,5})\s+налози/i.exec(I.filter((it) => end && it.page === end.page && Math.abs(it.y - end.y) < 25).sort((a, b) => (b.y - a.y) || (a.x - b.x)).map((x) => x.t).join(' '))
    ?? /вкупно\s+за\s+сметката.*?има\s+(\d{1,5})\s+налози/i.exec(all);
  const meta: string[][] = [
    ...(noTxt ? [[noTxt]] : []),
    ...(dateTxt ? [[`Извод ${dateTxt}`]] : []),
    ...(accIt ? [[`Број на сметката: ${accIt.t}`]] : []),
    ...(/денари/i.test(all) ? [['Валута: MKD']] : []),
    ...(open ? [[`Претходна состојба: ${open}`]] : []),
    ...(deb ? [[`Вкупно задолжување: ${deb}`]] : []),
    ...(cred ? [[`Вкупно одобрување: ${cred}`]] : []),
    ...(close ? [[`Нова состојба: ${close}`]] : []),
  ];
  const header = ['Ред. бр.', 'Назив на примачот', 'Број на сметката', 'Шифра', 'Цел на дознаката', 'Повикување на број', 'Задолжување', 'Побарување'];
  return { grid: [...meta, header, ...rows], hi: meta.length, count: cnt ? +cnt[1]! : null };
}
