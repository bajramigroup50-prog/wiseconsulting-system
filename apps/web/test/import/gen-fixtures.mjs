/**
 * Synthetic import fixtures for the import audit (docs/IMPORT-AUDIT.md): bank statements in the layouts of the
 * Macedonian banks (PDF with a real text layer rendered by Chromium, Excel, CSV), invoices (PDF), and Excel files
 * for partners / articles / firms / payroll. The data is invented; the layouts follow what the banks print
 * (header block with account, statement number, period / date, balances; repeated page headers; multi-line text;
 * MK „1.234,56“ and dot „1,234.56“ numbers; amounts printed a little below the text line).
 *
 *   cd apps/web && node test/import/gen-fixtures.mjs        (CHROMIUM_PATH = Chrome / Edge when not in the usual place)
 *
 * Writes test/import/fixtures/*.{pdf,xlsx,csv} and expected.json (what each file must import as).
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { chromium } from '@playwright/test';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ money / dates */
const grp = (s, sep) => s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
const mk = (c) => (c < 0 ? '-' : '') + grp(String(Math.trunc(Math.abs(c) / 100)), '.') + ',' + String(Math.abs(c) % 100).padStart(2, '0');
const dot = (c) => (c < 0 ? '-' : '') + grp(String(Math.trunc(Math.abs(c) / 100)), ',') + '.' + String(Math.abs(c) % 100).padStart(2, '0');
const dmy = (iso, sep = '.') => iso.slice(8, 10) + sep + iso.slice(5, 7) + sep + iso.slice(0, 4);
const dmy2 = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(2, 4);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* ------------------------------------------------------------------ transactions */
const POOL = [
  ['ГАМА КОМЕРЦ ДООЕЛ Скопје', '300000000211234', 'Уплата по фактура 47/2026 и 48/2026', '200', '0047-2026', 2500000],
  ['ТЕЛЕКОМ АД Скопје', '210000000012345', 'Телеком месечна сметка за февруари 2026, корисник 389 2 3100 000', '930', '9301234567', -236000],
  ['УЈП – Управа за јавни приходи', '100000000063095', 'ДДВ за период 02/2026', '930', 'MK4030999000111', -1845000],
  ['БЕТА ТРЕЈД ДОО Битола', '250000000098765', 'Враќање депозит по договор 12/2025', '201', '', 120050],
  ['ЕВН МАКЕДОНИЈА АД', '320000000044455', 'Електрична енергија броило 556677, 01-28.02.2026', '930', '20260228556677', -412300],
  ['ДЕЛТА ПЛУС ДООЕЛ Тетово', '380000000077788', 'Аванс за испорака на стока по профактура 15', '220', 'PF-15', 1000000],
  ['Провизија', '', 'Провизија за платен промет', '696', '', -4500],
  ['ВРАБОТЕН ПЕТРОВСКИ', '200000000555666', 'Нето плата 02/2026', '401', '022026', -3450000],
];
/** n transactions from the pool on the given dates (cycled), amounts varied a little so lines are not identical. */
function txs(n, dates) {
  return Array.from({ length: n }, (_, i) => {
    const p = POOL[i % POOL.length];
    const k = Math.floor(i / POOL.length);
    const amt = p[5] + (p[5] > 0 ? 1 : -1) * k * 1037;
    return { date: dates[i % dates.length], name: p[0], acc: p[1], purpose: p[2], code: p[3], ref: p[4], amt };
  });
}
const sum = (T) => T.reduce((a, t) => a + t.amt, 0);
const out = (T) => -T.filter((t) => t.amt < 0).reduce((a, t) => a + t.amt, 0);
const inn = (T) => T.filter((t) => t.amt > 0).reduce((a, t) => a + t.amt, 0);

/* ------------------------------------------------------------------ HTML → PDF */
const CSS = `
  @page { size: A4; margin: 14mm 10mm; }
  body { font-family: Arial, sans-serif; font-size: 8pt; color: #000; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 0.5px solid #888; padding: 2px 3px; vertical-align: top; }
  th { font-weight: bold; text-align: center; }
  td.n { text-align: right; white-space: nowrap; }
  td:first-child, td:nth-child(2) { white-space: nowrap; }
  td.low span { position: relative; top: 3.5px; }
  thead { display: table-header-group; }
  .hd { margin: 0 0 2px; } .big { font-size: 11pt; font-weight: bold; }
  .sum td { border: 0; padding: 1px 6px 1px 0; }
`;
const cellHtml = (c) => (c == null ? '' : esc(c).replace(/\n/g, '<br>'));
/** A table: thead rows of [text, colspan?, rowspan?], body rows of cells ({t, n?, low?} or text). */
function table(thead, body, foot = []) {
  const th = thead.map((r) => '<tr>' + r.map(([t, cs = 1, rs = 1]) => `<th colspan="${cs}" rowspan="${rs}">${cellHtml(t)}</th>`).join('') + '</tr>').join('');
  const td = (r) => '<tr>' + r.map((c) => {
    const o = typeof c === 'object' && c ? c : { t: c };
    const cls = [o.n ? 'n' : '', o.low ? 'low' : ''].filter(Boolean).join(' ');
    return `<td${cls ? ` class="${cls}"` : ''}${o.cs ? ` colspan="${o.cs}"` : ''}>${o.low ? `<span>${cellHtml(o.t)}</span>` : cellHtml(o.t)}</td>`;
  }).join('') + '</tr>';
  return `<table><thead>${th}</thead><tbody>${body.map(td).join('')}${foot.map(td).join('')}</tbody></table>`;
}
const page = (pre, tbl, post = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${pre}${tbl}${post}</body></html>`;
const lines = (L) => L.map((l) => `<div class="hd">${typeof l === 'string' ? esc(l) : l.html}</div>`).join('');
const sumTable = (labels, values) => `<table class="sum" style="width:auto;margin:4px 0"><tr>${labels.map((l) => `<td>${esc(l)}</td>`).join('')}</tr><tr>${values.map((v) => `<td style="text-align:right">${esc(v)}</td>`).join('')}</tr></table>`;

/* ------------------------------------------------------------------ banks */
const D = ['2026-03-05'];
const D3 = ['2026-03-02', '2026-03-03', '2026-03-04'];
const FIX = [];
const expected = {};
const exp = (id, o) => { expected[id] = o; };
const stmt = (T, opening, extra = {}) => ({
  opening, closing: opening + sum(T), debit: out(T), credit: inn(T), n: T.length,
  lines: T.map((t) => ({ date: t.date, amount: t.amt, name: t.name, ref: t.ref, code: t.code })),
  ...extra,
});

// 1 Комерцијална банка — one date column, Должи / Побарува, MK numbers, total row and new balance below
{
  const T = txs(8, D), O = 21674850;
  const pre = lines(['<b class="big">КОМЕРЦИЈАЛНА БАНКА АД СКОПЈЕ</b>'].map((h) => ({ html: h })).concat([
    'Комитент: ВАЈС КОНСАЛТИНГ ДООЕЛ Скопје, ЕДБ 4030999000111', 'Сметка: 300-0000012345-67   Валута: MKD', 'ИЗВОД бр. 48 од 05.03.2026',
    `Претходна состојба: ${mk(O)}`,
  ]));
  const body = T.map((t) => [dmy(t.date), t.name, t.acc, t.purpose, t.code, t.ref, { t: t.amt < 0 ? mk(-t.amt) : '', n: 1 }, { t: t.amt > 0 ? mk(t.amt) : '', n: 1 }]);
  const html = page(pre, table([[['Датум'], ['Налогодавач / Примач'], ['Сметка'], ['Цел на дознака'], ['Шифра'], ['Повикување на број'], ['Должи'], ['Побарува']]], body,
    [[{ t: 'Вкупно', cs: 6 }, { t: mk(out(T)), n: 1 }, { t: mk(inn(T)), n: 1 }]]), lines([`Нова состојба: ${mk(O + sum(T))}`]));
  const xlsx = [['КОМЕРЦИЈАЛНА БАНКА АД СКОПЈЕ'], ['Сметка: 300-0000012345-67'], ['ИЗВОД бр. 48 од 05.03.2026'], ['Претходна состојба:', O / 100],
    ['Датум', 'Налогодавач / Примач', 'Сметка', 'Цел на дознака', 'Шифра', 'Повикување на број', 'Должи', 'Побарува'],
    ...T.map((t) => [dmy(t.date), t.name, t.acc, t.purpose, t.code, t.ref, t.amt < 0 ? -t.amt / 100 : '', t.amt > 0 ? t.amt / 100 : '']),
    ['Вкупно', '', '', '', '', '', out(T) / 100, inn(T) / 100], ['Нова состојба:', (O + sum(T)) / 100]];
  FIX.push({ id: 'kb', html, xlsx, csv: true });
  exp('kb', stmt(T, O, { no: '48', account: '300000001234567', date: '2026-03-05' }));
}

// 2 Стопанска банка — booking + value date, running balance, MULTI-PAGE (repeated header, page footer), MK numbers
{
  const T = txs(46, D3), O = 120000000;
  let bal = O;
  const body = T.map((t) => { bal += t.amt; return [dmy(t.date), dmy(t.date), t.purpose, t.name, t.acc, { t: t.amt < 0 ? mk(-t.amt) : '', n: 1 }, { t: t.amt > 0 ? mk(t.amt) : '', n: 1 }, { t: mk(bal), n: 1 }]; });
  const pre = lines([{ html: '<b class="big">СТОПАНСКА БАНКА АД - СКОПЈЕ</b>' }, 'ИЗВОД НА СМЕТКА бр. 12', 'Број на сметка: 200000000123456', 'Период: 02.03.2026 - 04.03.2026']) +
    sumTable(['Почетно салдо', 'Вкупно одлив', 'Вкупно прилив', 'Крајно салдо'], [mk(O), mk(out(T)), mk(inn(T)), mk(O + sum(T))]);
  const html = page(pre, table([[['Датум на книжење'], ['Датум валута'], ['Опис'], ['Налогодавач / Корисник'], ['Сметка на налогодавач / корисник'], ['Одлив'], ['Прилив'], ['Салдо']]], body));
  const xlsx = [['СТОПАНСКА БАНКА АД - СКОПЈЕ'], ['ИЗВОД НА СМЕТКА бр. 12'], ['Број на сметка: 200000000123456'], ['Период: 02.03.2026 - 04.03.2026'],
    ['Почетно салдо', 'Вкупно одлив', 'Вкупно прилив', 'Крајно салдо'], [mk(O), mk(out(T)), mk(inn(T)), mk(O + sum(T))],
    ['Датум на книжење', 'Датум валута', 'Опис', 'Налогодавач / Корисник', 'Сметка на налогодавач / корисник', 'Одлив', 'Прилив', 'Салдо'],
    ...body.map((r) => r.map((c) => (typeof c === 'object' ? c.t : c)))];
  FIX.push({ id: 'stb', html, xlsx, footer: true });
  exp('stb', stmt(T, O, { no: '12', account: '200000000123456' }));
}

// 3 НЛБ Банка — ordinal, name + account on two lines in one cell, wrapped purpose, dd/mm/yyyy, summary as label row over values
{
  const T = txs(8, ['2026-03-05']), O = 5000000;
  const body = T.map((t, i) => [String(i + 1), dmy(t.date, '/'), t.name + (t.acc ? '\n' + t.acc.replace(/^(\d{3})(\d{10})(\d{2})$/, '$1-$2-$3') : ''), t.purpose, t.code, t.ref,
    { t: t.amt < 0 ? mk(-t.amt) : '0,00', n: 1 }, { t: t.amt > 0 ? mk(t.amt) : '0,00', n: 1 }]);
  const pre = lines([{ html: '<b class="big">НЛБ Банка АД Скопје</b>' }, 'Извод број: 2026031', 'Датум на извод: 05/03/2026', 'Трансакциска сметка 210-0000000777-88 ВАЈС КОНСАЛТИНГ ДООЕЛ']) +
    sumTable(['Претходна состојба', 'Вкупно задолжување', 'Вкупно одобрување', 'Нова состојба'], [mk(O), mk(out(T)), mk(inn(T)), mk(O + sum(T))]);
  const html = page(pre, table([[['Р.бр.'], ['Датум'], ['Назив и сметка на налогодавач / примач'], ['Цел на плаќање'], ['Шифра'], ['Референца'], ['Задолжување'], ['Одобрување']]], body));
  FIX.push({ id: 'nlb', html });
  exp('nlb', stmt(T, O, { no: '31', account: '210000000077788', date: '2026-03-05' }));
}

// 4 Халк Банка — NO date column (date in the header), two header rows: „ИЗНОС“ over „задолжува | одобрува“, „број на
// сметката“ under the name, wrapped „Повикување на број (задолжување и / одобрување)“; dot numbers; second line per
// transaction with the account; credit amount printed right next to the code („0.00“ „666“)
const HALK = (() => {
  const T = txs(7, D).map((t) => ({ ...t, name: t.name === 'Провизија' ? 'ХАЛК БАНКА АД СКОПЈЕ' : t.name, acc: t.acc || '250000000000001', purpose: t.name === 'Провизија' ? '[AutoProv]надомест за извршен платен промет' : t.purpose }));
  const O = 100000000;
  return { T, O };
})();
{
  const { T, O } = HALK;
  const head = [[['Ред.\nбр.', 1, 2], ['Назив и седиште на примачот - налогодавач'], ['ИЗНОС', 2], ['Шифра', 1, 2], ['цел на дознаката', 1, 2], ['Повикување на број (задолжување и']],
    [['број на сметката'], ['задолжува'], ['одобрува'], ['одобрување)']]];
  const body = [];
  T.forEach((t, i) => {
    body.push([String(i + 1), t.name, { t: dot(t.amt < 0 ? -t.amt : 0), n: 1 }, { t: dot(t.amt > 0 ? t.amt : 0), n: 1 }, t.code, t.purpose, t.ref]);
    body.push(['', t.acc, '', '', '', '', '']);
  });
  const pre = lines([{ html: '<b class="big">HALKBANK АД СКОПЈЕ</b>' }, 'ИЗВОД бр. 45 од 05.03.2026 година', 'Сметка: 270-0000012399-11  ВАЈС КОНСАЛТИНГ ДООЕЛ', `Претходна состојба: ${dot(O)}`]);
  const post = lines([`Вкупно задолжување: ${dot(out(T))}`, `Вкупно одобрување: ${dot(inn(T))}`, `Нова состојба: ${dot(O + sum(T))}`]);
  const html = page(pre, table(head, body).replace(/<td class="n">/g, '<td class="n" style="padding-right:0">').replace(/(<td class="n" style="padding-right:0">[^<]*<\/td>)<td>/g, '$1<td style="padding-left:1px">'), post);
  // the same statement as a PDF converted to Excel (what the user loaded in the converter): sub-headings in one cell,
  // the credit amount glued to the code, the account on a second row
  const xlsx = [['HALKBANK АД СКОПЈЕ'], ['ИЗВОД бр. 45 од 05.03.2026 година'], ['Сметка: 270-0000012399-11  ВАЈС КОНСАЛТИНГ ДООЕЛ'], [`Претходна состојба: ${dot(O)}`],
    ['Ред. бр.', 'Назив и седиште на примачот - налогодавач', '', 'ИЗНОС', 'Шифра', 'цел на дознаката', 'Повикување на број (задолжување и'],
    ['', 'број на сметката', '', 'задолжува одобрува', '', '', 'одобрување)'],
    ...T.flatMap((t, i) => [[String(i + 1), t.name, '', dot(t.amt < 0 ? -t.amt : 0), `${dot(t.amt > 0 ? t.amt : 0)} ${t.code}`, t.purpose, t.ref], ['', t.acc, '', '', '', '', '']]),
    [`Вкупно задолжување: ${dot(out(T))}`], [`Вкупно одобрување: ${dot(inn(T))}`], [`Нова состојба: ${dot(O + sum(T))}`]];
  FIX.push({ id: 'halk', html, xlsx });
  exp('halk', stmt(T, O, { no: '45', account: '270000001239911', date: '2026-03-05' }));
}

// 5 Шпаркасе — single signed „Износ“ with a „Д/П“ indicator, value date, MK numbers
{
  const T = txs(8, D3), O = 3000000;
  const body = T.map((t) => [dmy(t.date), dmy(t.date), t.purpose, t.name, { t: mk(Math.abs(t.amt)), n: 1 }, t.amt < 0 ? 'Д' : 'П']);
  const pre = lines([{ html: '<b class="big">Шпаркасе Банка АД Скопје</b>' }, 'Извод бр. 7', 'IBAN: MK07 2500 0000 0012 345', 'Сметка 250-0000000123-45', 'За период од 02.03.2026 до 04.03.2026', `Состојба на почеток: ${mk(O)}`]);
  const html = page(pre, table([[['Датум'], ['Валута'], ['Опис на трансакција'], ['Партнер'], ['Износ'], ['Д/П']]], body), lines([`Состојба на крај: ${mk(O + sum(T))}`]));
  FIX.push({ id: 'spk', html });
  exp('spk', stmt(T, O, { no: '7', account: '250000000012345' }));
}

// 6 ПроКредит — bilingual headings, ISO dates, dot numbers
{
  const T = txs(8, D3), O = 1234500;
  const body = T.map((t) => [t.date, t.name + ' / ' + t.purpose, t.ref, { t: t.amt < 0 ? dot(-t.amt) : '', n: 1 }, { t: t.amt > 0 ? dot(t.amt) : '', n: 1 }]);
  const pre = lines([{ html: '<b class="big">ProCredit Bank / ПроКредит Банка АД Скопје</b>' }, 'Извод бр. / Statement no. 33', 'Сметка / Account: 380-0000000555-12', 'Period: 2026-03-02 - 2026-03-04', `Почетна состојба / Opening balance: ${dot(O)}`]);
  const html = page(pre, table([[['Датум / Date'], ['Опис / Description'], ['Референца / Reference'], ['Задолжување / Debit'], ['Одобрување / Credit']]], body),
    lines([`Крајна состојба / Closing balance: ${dot(O + sum(T))}`]));
  FIX.push({ id: 'pcb', html, csv: true, csvRows: [['Датум / Date', 'Опис / Description', 'Референца / Reference', 'Задолжување / Debit', 'Одобрување / Credit'], ...body.map((r) => r.map((c) => (typeof c === 'object' ? c.t : c)))] });
  exp('pcb', stmt(T, O, { no: '33', account: '380000000055512', nameIn: 'desc' }));
}

// 7 УНИ Банка — amounts printed 3.5 pt BELOW the text line of the transaction (the baseline offset), MK numbers
{
  const T = txs(8, D), O = 800000;
  const body = T.map((t) => [dmy(t.date), t.ref, t.name, t.purpose, { t: t.amt < 0 ? mk(-t.amt) : '', n: 1, low: 1 }, { t: t.amt > 0 ? mk(t.amt) : '', n: 1, low: 1 }]);
  const pre = lines([{ html: '<b class="big">УНИ Банка АД Скопје</b>' }, 'Извод бр. 9 од 05.03.2026', 'Сметка: 240-0000000321-09', `Претходна состојба ${mk(O)}`]);
  const html = page(pre, table([[['Датум'], ['Број на налог'], ['Налогодавач / Примач'], ['Цел на дознака'], ['Одлив'], ['Прилив']]], body), lines([`Нова состојба ${mk(O + sum(T))}`]));
  FIX.push({ id: 'uni', html });
  exp('uni', stmt(T, O, { no: '9', account: '240000000032109', date: '2026-03-05' }));
}

// 8 Силк Роуд — „Почетно / Крајно салдо“, three-line descriptions
{
  const T = txs(6, D3), O = 990000;
  const body = T.map((t) => [dmy(t.date), `${t.name}\n${t.purpose}\nшифра ${t.code}`, { t: t.amt < 0 ? mk(-t.amt) : '', n: 1 }, { t: t.amt > 0 ? mk(t.amt) : '', n: 1 }]);
  const pre = lines([{ html: '<b class="big">Силк Роуд Банка АД Скопје</b>' }, 'Извод бр. 3', 'Сметка: 370-0000000111-22', `Почетно салдо: ${mk(O)}`]);
  const html = page(pre, table([[['Датум'], ['Опис'], ['Должи'], ['Побарува']]], body), lines([`Крајно салдо: ${mk(O + sum(T))}`]));
  FIX.push({ id: 'silk', html });
  exp('silk', stmt(T, O, { no: '3', account: '370000000011122', nameIn: 'desc' }));
}

// 9 ТТК Банка — abbreviated headings, two-digit years
{
  const T = txs(8, D3), O = 4500000;
  const body = T.map((t) => [dmy2(t.date), dmy2(t.date), t.name, t.purpose, t.ref, { t: t.amt < 0 ? mk(-t.amt) : '', n: 1 }, { t: t.amt > 0 ? mk(t.amt) : '', n: 1 }]);
  const pre = lines([{ html: '<b class="big">ТТК Банка АД Скопје</b>' }, 'Извод бр. 21', 'Сметка: 290-0000000444-33', `Претходно салдо: ${mk(O)}`]);
  const html = page(pre, table([[['Дат. книж.'], ['Дат. вал.'], ['Корисник / Налогодавач'], ['Цел'], ['Повик. бр.'], ['Задолжено'], ['Одобрено']]], body), lines([`Ново салдо: ${mk(O + sum(T))}`]));
  FIX.push({ id: 'ttk', html });
  exp('ttk', stmt(T, O, { no: '21', account: '290000000044433' }));
}

// 10 Централна кооперативна банка — one signed „Износ“ with trailing minus („1.234,56-“), „Жиро сметка“ column
{
  const T = txs(8, D), O = 2500000;
  const body = T.map((t) => [dmy(t.date), t.name, t.acc, t.purpose, t.code, { t: t.amt < 0 ? mk(-t.amt) + '-' : mk(t.amt), n: 1 }]);
  const pre = lines([{ html: '<b class="big">ЦЕНТРАЛНА КООПЕРАТИВНА БАНКА АД СКОПЈЕ</b>' }, 'Извод бр. 15 на ден 05.03.2026', 'Сметка: 230-0000000999-01', `Претходна состојба: ${mk(O)}`]);
  const html = page(pre, table([[['Датум'], ['Налогодавач - Примач'], ['Жиро сметка'], ['Опис'], ['Шифра'], ['Износ']]], body), lines([`Нова состојба: ${mk(O + sum(T))}`]));
  FIX.push({ id: 'ckb', html });
  exp('ckb', stmt(T, O, { no: '15', account: '230000000099901', date: '2026-03-05' }));
}

/* ------------------------------------------------------------------ invoices */
const INV = [];
{
  // purchase invoice with a VAT recapitulation 18 / 10 / 5 / 0
  const g = [[18, 100000, 18000], [10, 50000, 5000], [5, 20000, 1000], [0, 7000, 0]];
  const total = g.reduce((a, [, b, v]) => a + b + v, 0);
  const html = page(lines([{ html: '<b class="big">ДОБАВУВАЧ ПЛУС ДООЕЛ Скопје</b>' }, 'ул. Партизанска 10, Скопје · ЕДБ: MK4030999000222 · ЕМБС 7000111',
    'Купувач: ВАЈС КОНСАЛТИНГ ДООЕЛ, ЕДБ 4030999000111', { html: '<b class="big">ФАКТУРА бр. 0123/2026</b>' }, 'Датум на фактура: 15.03.2026', 'Валута: 14.04.2026']),
  table([[['Р.бр.'], ['Опис'], ['Количина'], ['Цена'], ['ДДВ %'], ['Износ']]], [
    ['1', 'Канцелариски материјал', { t: '10', n: 1 }, { t: mk(10000), n: 1 }, '18', { t: mk(100000), n: 1 }],
    ['2', 'Книги', { t: '5', n: 1 }, { t: mk(10000), n: 1 }, '10', { t: mk(50000), n: 1 }],
    ['3', 'Лекови', { t: '2', n: 1 }, { t: mk(10000), n: 1 }, '5', { t: mk(20000), n: 1 }],
    ['4', 'Поштенски услуги', { t: '1', n: 1 }, { t: mk(7000), n: 1 }, '0', { t: mk(7000), n: 1 }]]),
  '<h4>Рекапитулација на ДДВ</h4>' + table([[['Стапка'], ['Основица'], ['ДДВ']]], g.map(([r, b, v]) => [`ДДВ ${r}%`, { t: mk(b), n: 1 }, { t: mk(v), n: 1 }])) +
  lines([`Вкупно за плаќање: ${mk(total)}`]));
  INV.push({ id: 'inv-recap', html });
  exp('inv-recap', { number: '0123/2026', date: '2026-03-15', dueDate: '2026-04-14', edb: '4030999000222', groups: g.map(([rate, b, v]) => ({ rate, base: b / 100, vat: v / 100 })), total: total / 100 });
}
{
  // dot-format invoice of a foreign-styled program: „1,180.00“
  const html = page(lines(['SUPPLIER TRADE DOO Skopje, ЕДБ MK4030999000333', 'Фактура бр. INV-2026-77', 'Датум: 2026-03-20']),
    table([[['Опис'], ['Основица'], ['ДДВ 18%'], ['Вкупно']]], [['Услуги', { t: dot(1000000), n: 1 }, { t: dot(180000), n: 1 }, { t: dot(1180000), n: 1 }]]) +
    lines(['ДДВ 18%   ' + dot(1000000) + '   ' + dot(180000), `Вкупно за плаќање: ${dot(1180000)}`]));
  INV.push({ id: 'inv-dot', html });
  exp('inv-dot', { number: 'INV-2026-77', date: '2026-03-20', edb: '4030999000333', groups: [{ rate: 18, base: 10000, vat: 1800 }], total: 11800 });
}

/* ------------------------------------------------------------------ Excel imports (partners, articles, firms, payroll) */
const XL = {
  partners: [['Шифра', 'Назив', 'ЕДБ', 'ЕМБС', 'Адреса', 'Град', 'Жиро сметка', 'Телефон', 'Е-пошта'],
    ['1029', 'МАЈАНЦЕ ДООЕЛ', 'MK4030999000444', '7000222', 'ул. Илинденска 5', 'Тетово', '300-0000000123-45', '044 123 456', 'info@majance.mk'],
    ['1030', 'ГАМА КОМЕРЦ ДООЕЛ', '4030999000555', '7000333', 'бул. Партизански одреди 1', 'Скопје', '200000000098765', '02 3123 456', '']],
  items: [['Шифра', 'Назив', 'Ед. мерка', 'ДДВ %', 'Набавна цена', 'Продажна цена', 'Баркод'],
    ['A-001', 'Хартија A4 80g', 'пак', '18', '210,50', '299,00', '3830001234567'], ['A-002', 'Книга „Сметководство“', 'парче', '10', '1.200,00', '1.590,00', ''], ['A-003', 'Леб', 'кг', '5', 45, 60, '']],
  firms: [['Шифра', 'Име на фирма', 'Правна форма', 'ЕДБ', 'Матичен број', 'Адреса', 'Град', 'Жиро сметка', 'Банка', 'ДДВ обврзник', 'ДДВ период'],
    ['F01', 'АЛФА ДООЕЛ', 'ДООЕЛ', '4030999000666', '7000444', 'ул. Македонија 1', 'Скопје', '300000000012345', 'Комерцијална банка', 'да', 'месечно'],
    ['F02', 'БЕТА ДОО', 'ДОО', '4030999000777', '7000555', 'ул. Гоце Делчев 2', 'Битола', '210000000012345', 'НЛБ Банка', 'не', ''],
    ['F03', 'ГАМА ТП', 'ТП', '4030999000888', '7000666', '', 'Охрид', '', '', 'DA', '3M']],
  payroll: [['ЕМБГ', 'Име и презиме', 'Работно место', 'Нето плата', 'Бруто плата', 'Редовни часови', 'Боледување', 'Годишен одмор'],
    ['0101990450012', 'Петар Петровски', 'Сметководител', '34.500,00', '', '160', '0', '8'],
    ['1505985455019', 'Марија Марковска', 'Комерцијалист', '', '52.000,00', '168', '8', '0']],
};

/* ------------------------------------------------------------------ write */
const exe = process.env.CHROMIUM_PATH || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--font-render-hinting=none'] });
const pg = await browser.newPage();
for (const f of [...FIX, ...INV]) {
  await pg.setContent(f.html, { waitUntil: 'load' });
  const footer = f.footer ? '<div style="font-size:7pt;font-family:Arial;width:100%;text-align:center">Страна <span class="pageNumber"></span> од <span class="totalPages"></span></div>' : '<span></span>';
  writeFileSync(join(OUT, `${f.id}.pdf`), await pg.pdf({ format: 'A4', printBackground: false, displayHeaderFooter: !!f.footer, headerTemplate: '<span></span>', footerTemplate: footer, margin: { top: '14mm', bottom: '16mm', left: '10mm', right: '10mm' } }));
  if (f.xlsx) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f.xlsx), 'Извод');
    writeFileSync(join(OUT, `${f.id}.xlsx`), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }
  if (f.csv) {
    const rows = f.csvRows ?? f.xlsx;
    writeFileSync(join(OUT, `${f.id}.csv`), '\ufeff' + rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n'));
  }
}
await browser.close();
for (const [k, rows] of Object.entries(XL)) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), k);
  writeFileSync(join(OUT, `${k}.xlsx`), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
writeFileSync(join(OUT, 'expected.json'), JSON.stringify(expected, null, 1));
console.log('fixtures:', [...FIX, ...INV].map((f) => f.id).join(', '), '+', Object.keys(XL).join(', '));
