/**
 * Payroll fixtures for the golden tests. All personal data is synthetic: EMBGs, EDB and bank
 * accounts are made up (the legacy `MPIN_SAMPLE` with a real-looking EDB is NOT used).
 */
import type { PayEmp, PayParams } from '../../../src/payroll';

export const MONTH = '2026-09';

/** Official 2026-07 row + September 2026 hour fund (22 weekdays × 8). */
export const PARAMS: PayParams = {
  avg: 69141,
  minBase: 34571,
  maxBase: 1106256,
  exempt: 10932,
  minGross: 38507,
  minNet: 26046,
  pio: 19.9,
  zdr: 7.5,
  dop: 0.5,
  vrab: 0.1,
  tax: 10,
  hours: 176,
  pfrom: '2026-07',
};

const reg = (hours: number) => ({ type: 'Редовно работење', hours, pct: 100, cat: 'reg' as const });

/** Statutory minimum net, full time, no seniority → exactly minGross. */
export const EMP_MIN: PayEmp = { empId: 'e1', no: '1', name: 'Ана Петровска', embg: '0101990455001', netBase: 26046, coef: 1, stazY: 0, lines: [reg(176)] };

/** Minimum net with 6 years of seniority → gross-from-net path + 3% supplement. */
export const EMP_MIN_STAZ: PayEmp = { ...EMP_MIN, empId: 'e2', no: '2', name: 'Марко Стојанов', embg: '0202985450002', stazY: 6 };

/** Typical employee with overtime, sick leave, annual leave, holiday, bonus, fine and union fee. */
export const EMP_MIXED: PayEmp = {
  empId: 'e3',
  no: '3',
  name: 'Елена Трајковска Николова',
  embg: '0303988455003',
  netBase: 42500,
  coef: 1,
  stazY: 11,
  lines: [
    reg(120),
    { type: 'Годишен одмор', hours: 24, pct: 100 },
    { type: 'Боледување до 30 дена', hours: 16, pct: 70 },
    { type: 'Државен празник', hours: 16, pct: 100 },
    { type: 'Прекувремена работа', hours: 9, pct: 135 },
    { type: 'Работа во недела', hours: 5, pct: 150 },
    { type: 'Награда / бонус', amt: 5000 },
    { type: 'Казна / намалување', amt: -1333 },
    { type: 'Синдикална членарина', amt: 425 },
    { type: 'Кредит / судска забрана (задршка)', amt: 3000.4 },
  ],
};

/** Agreed gross instead of net. */
export const EMP_GROSS: PayEmp = { empId: 'e4', no: '4', name: 'Петар Илиевски', embg: '0404979450004', grossBase: 61237, coef: 1, stazY: 3, lines: [reg(160), { type: 'Државен празник', hours: 16, pct: 100 }] };

/** Half-time by coefficient: minimum gross pro-rated (v486). */
export const EMP_PART_COEF: PayEmp = { empId: 'e5', no: '5', name: 'Билјана Ристова', embg: '0505995455005', netBase: 26046, coef: 0.5, stazY: 0, lines: [reg(176)] };

/** Part-time by hour fund (hNorm 80 of 176) and a low agreed net → raised to pro-rated minimum. */
export const EMP_PART_HOURS: PayEmp = { empId: 'e6', no: '6', name: 'Горан Јовановски', embg: '0606992450006', netBase: 9000, coef: 1, stazY: 2, hNorm: 80, lines: [reg(72), { type: 'Државен празник', hours: 8, pct: 100 }] };

/** Worked fewer hours than the fund with unpaid leave → employer top-up to the minimum base (dPio…). */
export const EMP_TOPUP: PayEmp = { empId: 'e7', no: '7', name: 'Сашо Димитров', embg: '0707987450007', netBase: 26046, coef: 1, stazY: 0, lines: [reg(96), { type: 'Неплатено отсуство', hours: 80, pct: 0 }] };

/** Tax-exempt employee (noTax). */
export const EMP_NOTAX: PayEmp = { empId: 'e8', no: '8', name: 'Ивана Колева', embg: '0808999455008', netBase: 31000, coef: 1, stazY: 1, noTax: true, lines: [reg(176)] };

/** Joined mid-month (MPIN days). */
export const EMP_IN: PayEmp = { empId: 'e9', no: '9', name: 'Дарко Мицевски', embg: '0909991450009', netBase: 35000, coef: 1, stazY: 0, inout: 'in', ioDate: '2026-09-14', lines: [reg(104)] };

/** High earner: gross far above the maximum contribution base (16 × average wage). */
export const EMP_HIGH: PayEmp = { empId: 'e10', no: '10', name: 'Виктор Ангеловски', embg: '1010975450010', netBase: 900000, coef: 1, stazY: 20, lines: [reg(176)] };

/** Below the cap: everything matches legacy exactly. */
export const NORMAL_EMPS: PayEmp[] = [EMP_MIN, EMP_MIN_STAZ, EMP_MIXED, EMP_GROSS, EMP_PART_COEF, EMP_PART_HOURS, EMP_TOPUP, EMP_NOTAX, EMP_IN];

/** Employee cards (`employees` collection) for MPIN / draft. */
export const EMPLOYEES = [
  { id: 'e1', no: '1', name: 'Ана Петровска', embg: '0101990455001', city: 'Скопје', address: 'ул. Партизанска 1', mpOps: '179', mpZan: '4061', bankAcc: '300-0000000001-23', netBase: 26046, coef: 1, start: '2019-02-01' },
  { id: 'e2', no: '2', name: 'Марко Стојанов', embg: '0202985450002', city: 'Битола', bankAcc: '210-0000000002-45', netBase: 26046, coef: 1, start: '2020-09-15', stazPrev: 0 },
  { id: 'e3', no: '3', name: 'Елена Трајковска Николова', embg: '0303988455003', city: 'Охрид', mpOps: '152', bankAcc: '200-0000000003-67', netBase: 42500, start: '2015-03-01' },
  { id: 'e4', no: '4', name: 'Петар Илиевски', embg: '0404979450004', city: 'Кисела Вода, Скопје', mpC26: '0047', bankAcc: '250-0000000004-89', netBase: 0, start: '2023-01-10' },
  { id: 'e5', no: '5', name: 'Билјана Ристова', embg: '0505995455005', address: 'с. Арачиново', bankAcc: '300-0000000005-01', netBase: 26046, coef: 0.5 },
  { id: 'e6', no: '6', name: 'Горан Јовановски', embg: '0606992450006', city: 'Штип', hNorm: 80, netBase: 9000, start: '2024-05-01', stazPrev: 0 },
  { id: 'e7', no: '7', name: 'Сашо Димитров', embg: '0707987450007', city: 'Скопје', netBase: 26046 },
  { id: 'e8', no: '8', name: 'Ивана Колева', embg: '0808999455008', city: 'Кавадарци', netBase: 31000, active: true },
  { id: 'e9', no: '9', name: 'Дарко Мицевски', embg: '0909991450009', city: 'Тетово', netBase: 35000, start: '2026-09-14' },
  { id: 'e10', no: '10', name: 'Виктор Ангеловски', embg: '1010975450010', city: 'Центар', mpOps: '182', netBase: 900000 },
  { id: 'e11', no: '11', name: 'Неактивен Вработен', embg: '1111111111111', active: false, netBase: 30000 },
  { id: 'e12', no: '12', name: 'Заминат Вработен', embg: '1212121212121', end: '2026-08-31', netBase: 30000 },
];

/** Synthetic firm (fake EDB). */
export const FIRM = { edb: 'МК4030000000001', embs: '7000001', name: 'Тест Трејд дооел Скопје', address: 'ул. Македонија 10', city: 'Скопје', opstina: '182' };

/** A synthetic previous MPI3 file used as template (fake EDB / EMBG). */
export const TEMPLATE_TXT = [
  '69141;10932;19.9;176;7.5;0.1;0.5;1;;;;;10;;;;;',
  '08;2026;101;110;2;12345.00;',
  '4030000000001;7000001;ТЕСТ ТРЕЈД ДООЕЛ СКОПЈЕ;;;;УЛ. МАКЕДОНИЈА 10;;СКОПЈЕ;skopje;182;1000;vb;02;vb;',
  ['1', '0202985450002', 'СТОЈАНОВ', 'МАРКО', '001', '4011', '103', '23', '176', '', '', '20000.00', ...Array(14).fill(''), '0050', ...Array(15).fill(''), '1', '', '', '210000000000245', ''].join(';'),
  ['2', '0707987450007', 'ДИМИТРОВ', 'САШО', '002', '4061', '177', '23', '176', '', '', '20000.00', ...Array(14).fill(''), '0050', ...Array(15).fill(''), '1', '', '', '', ''].join(';'),
  '***********************************',
  '101;110;2;12345.00;',
  '1.0.3328.99999',
  '',
].join('\r\n');
