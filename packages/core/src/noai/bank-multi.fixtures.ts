/**
 * SYNTHETIC text layer of an e-banking PDF export with several daily statements, one per page — the layout of
 * Комерцијална банка („Извод за промените и состојбата на сметката за ден …, број на извод N“, balance block
 * „Претходна состојба | Дневен промет долгува / побарува | Нова состојба“, table „Р.бр. | Назив на примач -
 * налогодавач | Сметка | Начин | Износ должи / побарува / пров. | Шиф | Цел на дознака | ПБО/ПБЗ | Рекламација“,
 * „Вкупно:“, footer „Сметка: … Извод број:N Датум на промет: …“). Positions as pdfjs gives them; every name, account
 * and amount is invented.
 */
import type { PdfItem } from './pdf-lines';

/** One text item: left x, baseline y, text; width estimated from the length (or the right edge `x1` for amounts). */
const T = (page: number, x: number, y: number, s: string, h = 8, x1?: number): PdfItem => {
  const w = x1 != null ? x1 - x : s.length * (h >= 10 ? 5.1 : 4.6);
  return { page, x: x1 != null ? x1 - w : x, y, w, h, s };
};
/** Right-aligned amount ending at `x1`. */
const R = (page: number, x1: number, y: number, s: string, h = 8): PdfItem => T(page, x1 - s.length * 4.4, y, s, h, x1);

export const MULTI_ACCOUNT = '300000001234567';

interface Row { name: string; name2?: string; acct: string; nacin: string; debit: string; credit: string; fee: string; code: string; purpose: string; purpose2?: string; ref: string; ref2?: string; rekl: string }
interface Day { no: number; date: string; opening: string; dDebit: string; dCredit: string; closing: string; rows: Row[]; tot: [string, string, string] }

export const MULTI_DAYS: Day[] = [
  {
    no: 161, date: '07.10.2026', opening: '5,000.00', dDebit: '0.00', dCredit: '4,500.00', closing: '9,500.00', tot: ['0.00', '4,500.00', '0.00'],
    rows: [
      { name: 'ПРИМЕР ТРЕЈД ДООЕЛ СКОПЈЕ', acct: '300000009990001', nacin: '0', debit: '0.00', credit: '1,200.00', fee: '0.00', code: '220', purpose: '0105/2026', ref: '0105/2026 /', ref2: '0105/2026', rekl: '11110001' },
      { name: 'ТЕСТ УСЛУГИ ДОО Тетово', acct: '210000009990002', nacin: '2', debit: '0.00', credit: '3,300.00', fee: '0.00', code: '220', purpose: 'Плаќање по фактура 12/2026', purpose2: 'за извршени услуги', ref: 'FAKTURA 12', ref2: '/ FAKTURA 12', rekl: '11110002' },
    ],
  },
  {
    no: 162, date: '09.10.2026', opening: '9,500.00', dDebit: '2,000.00', dCredit: '0.00', closing: '7,500.00', tot: ['2,000.00', '0.00', '18.00'],
    rows: [
      { name: 'СОПСТВЕНА ФИРМА ДООЕЛ Скопје', acct: '270000009990003', nacin: '2', debit: '2,000.00', credit: '0.00', fee: '18.00', code: '903', purpose: 'Пренос од средства на делот на', purpose2: 'правно лице и обратно', ref: 'prenos / prenos', rekl: '11110003' },
    ],
  },
  {
    no: 163, date: '10.10.2026', opening: '7,500.00', dDebit: '60.00', dCredit: '0.00', closing: '7,440.00', tot: ['60.00', '0.00', '0.00'],
    rows: [
      { name: 'БАНКА ПРИМЕР АД СКОПЈЕ -', name2: 'ПРОВИЗИЈА', acct: '300000000000999', nacin: '0', debit: '60.00', credit: '0.00', fee: '0.00', code: '666', purpose: 'Пров.ПП (нал.+ген.извод) за прва', purpose2: 'декада за 10.2026', ref: '160300999 /', rekl: '11110004' },
    ],
  },
];

function page(p: number, d: Day): PdfItem[] {
  const I: PdfItem[] = [
    T(p, 19, 520, 'Датум: 15.10.2026', 10),
    T(p, 171, 507, `Извод за промените и состојбата на сметката за ден ${d.date}, број на извод ${d.no}`, 10, 566),
    T(p, 21, 474, 'Број на сметката:', 10), T(p, 106, 474, MULTI_ACCOUNT, 10),
    T(p, 21, 462, 'Назив: ПРИМЕР КЛИЕНТ ДООЕЛ Скопје', 10), T(p, 235, 462, 'Даночен број:', 10), T(p, 303, 462, '4000000000000', 10),
    T(p, 39, 427, 'Претходна', 10), T(p, 160, 427, 'Дневен промет', 10), T(p, 294, 427, 'Нова состојба', 10), T(p, 423, 427, 'Број на налози', 10), T(p, 546, 427, 'Долг по основ на', 10),
    T(p, 47, 414, 'состојба', 10), T(p, 546, 414, 'провизија од ПП', 10),
    T(p, 138, 396, 'долгува', 10), T(p, 216, 396, 'побарува', 10), T(p, 385, 396, 'задолжување', 10), T(p, 471, 396, 'одобрување', 10), T(p, 578, 396, 'Износ', 10),
    R(p, 116, 377, d.opening, 10), R(p, 198, 377, d.dDebit, 10), R(p, 280, 377, d.dCredit, 10), R(p, 378, 377, d.closing, 10),
    R(p, 424, 377, String(d.rows.filter((r) => r.debit !== '0.00').length), 10), R(p, 506, 377, String(d.rows.filter((r) => r.credit !== '0.00').length), 10), R(p, 603, 377, '0.00', 10),
    T(p, 21, 354, 'Примивме во корист - на товар на сметката', 10),
    T(p, 25, 333, 'Р.бр.', 9, 48), T(p, 82, 333, 'Назив на примач -', 9, 168), T(p, 224, 333, 'Сметка', 9, 257), T(p, 284, 333, 'Начин', 9, 314), T(p, 393, 333, 'Износ', 9, 421),
    T(p, 502, 333, 'Шиф', 9, 526), T(p, 568, 333, 'Цел на дознака', 9, 641), T(p, 700, 333, 'ПБО/ПБЗ', 9, 744), T(p, 768, 333, 'Рекла-', 9, 800),
    T(p, 96, 322, 'налогодавач', 9, 156), T(p, 767, 322, 'мација', 9, 800),
    T(p, 332, 290, 'должи', 8, 360), T(p, 387, 290, 'побарува', 8, 426), T(p, 456, 290, 'пров.', 8, 479),
  ];
  let y = 274;
  d.rows.forEach((r, i) => {
    I.push(
      T(p, 34, y, String(i + 1), 8, 38), T(p, 55, y, r.name), T(p, 208, y, r.acct, 8, 273), T(p, 297, y, r.nacin, 8, 301),
      R(p, 375, y, r.debit), R(p, 435, y, r.credit), R(p, 496, y, r.fee), T(p, 507, y, r.code, 8, 520),
      T(p, 532, y, r.purpose), T(p, 681, y, r.ref), T(p, 768, y + 1, r.rekl, 7, 799),
    );
    if (r.name2) I.push(T(p, 55, y - 10, r.name2));
    if (r.purpose2) I.push(T(p, 532, y - 10, r.purpose2));
    if (r.ref2) I.push(T(p, 681, y - 10, r.ref2));
    y -= 23;
  });
  y -= 2;
  I.push(T(p, 277, y, 'Вкупно:', 9, 314), R(p, 375, y, d.tot[0]), R(p, 435, y, d.tot[1]), R(p, 496, y, d.tot[2]));
  if (p === 3) I.push(T(p, 21, 216, 'Ве известуваме дека Банката изврши промена на Тарифата на надоместоци за услуги од областа на платежни услуги', 10, 798));
  I.push(
    T(p, 24, 11, `Сметка: ${MULTI_ACCOUNT}`, 8, 147), T(p, 155, 11, `Извод број:${d.no}`, 8, 225), T(p, 338, 11, `Датум на промет: ${d.date}`, 8, 473),
    T(p, 481, 11, 'Датум на издавање:15.10.2026', 8, 625), T(p, 736, 11, 'Страна 1 од 1', 8, 801),
  );
  return I;
}

/** The three daily statements 161 / 162 / 163 on pages 1–3. */
export const multiStatementItems = (): PdfItem[] => MULTI_DAYS.flatMap((d, i) => page(i + 1, d));
