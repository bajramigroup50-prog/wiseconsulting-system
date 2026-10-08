/**
 * Explanatory notes to the annual account (legacy `BEL` 10905–10918, `belAuto` 10919, `belHTML` 10924).
 *
 * Each note has a title, optional AOP rows (current + previous year) and a text: the saved text for the year, else
 * the previous year's text (except the two notes that name the year), else the automatic text.
 */
import { dbEdb } from './tax';
import { yeLegalFormName } from './entity';

export type BelRow = readonly ['bs' | 'bu', string, string];
export type BelNote = readonly [id: string, title: string, rows: readonly BelRow[] | null];

export const BEL: readonly BelNote[] = [
  ['gen', 'Општи податоци', null],
  ['osn', 'Основа за составување на финансиските извештаи', null],
  ['pol', 'Значајни сметководствени политики', null],
  ['nm', 'Нематеријални средства', [['bs', '002', 'Нематеријални средства']]],
  ['ms', 'Материјални средства', [['bs', '009', 'Материјални средства'], ['bs', '010', 'Недвижности'], ['bs', '013', 'Постројки и опрема'], ['bs', '014', 'Транспортни средства'], ['bs', '015', 'Алат, инвентар и мебел']]],
  ['zl', 'Залихи', [['bs', '037', 'Залихи – вкупно'], ['bs', '038', 'Суровини и материјали'], ['bs', '042', 'Трговски стоки'], ['bs', '041', 'Готови производи']]],
  ['pb', 'Краткорочни побарувања', [['bs', '045', 'Краткорочни побарувања – вкупно'], ['bs', '047', 'Побарувања од купувачи'], ['bs', '048', 'Дадени аванси на добавувачи'], ['bs', '049', 'Побарувања од државата']]],
  ['pr', 'Парични средства', [['bs', '059', 'Парични средства и парични еквиваленти']]],
  ['kp', 'Главнина и резерви', [['bs', '065', 'Главнина и резерви – вкупно'], ['bs', '066', 'Основна главнина'], ['bs', '075', 'Акумулирана добивка'], ['bs', '077', 'Добивка за деловната година'], ['bs', '078', 'Загуба за деловната година']]],
  ['ob', 'Обврски', [['bs', '085', 'Долгорочни обврски'], ['bs', '095', 'Краткорочни обврски – вкупно'], ['bs', '097', 'Обврски спрема добавувачи'], ['bs', '099', 'Обврски за даноци, придонеси и плати'], ['bs', '101', 'Тековни даночни обврски']]],
  ['ph', 'Приходи', [['bu', '201', 'Приходи од работењето'], ['bu', '202', 'Приходи од продажба'], ['bu', '203', 'Останати приходи'], ['bu', '223', 'Финансиски приходи']]],
  ['rs', 'Расходи', [['bu', '207', 'Расходи од работењето'], ['bu', '208', 'Суровини и материјали'], ['bu', '209', 'Набавна вредност на продадени стоки'], ['bu', '211', 'Услуги'], ['bu', '213', 'Трошоци за вработени'], ['bu', '218', 'Амортизација'], ['bu', '212', 'Останати трошоци'], ['bu', '234', 'Финансиски расходи']]],
  ['dn', 'Резултат и данок на добивка', [['bu', '250', 'Добивка пред оданочување'], ['bu', '251', 'Загуба пред оданочување'], ['bu', '252', 'Данок на добивка'], ['bu', '255', 'Нето добивка'], ['bu', '256', 'Нето загуба']]],
  ['vr', 'Вработени', [['bu', '257', 'Просечен број на вработени']]],
  ['nd', 'Настани по датумот на билансот', null],
];

export interface BelFirm {
  name?: string | null;
  legalForm?: string | null;
  embs?: string | null;
  edb?: string | null;
  address?: string | null;
  city?: string | null;
  activity?: string | null;
  signer?: string | null;
}

/** Automatic text of a note (legacy `belAuto`). */
export function belAuto(id: string, f: BelFirm, Y: number): string {
  const lf = yeLegalFormName(f.legalForm);
  if (id === 'gen')
    return `${f.name || ''}${lf ? ' (' + lf + ')' : ''} е регистрирано во Централниот регистар на Република Северна Македонија со ЕМБС ${f.embs || '____'} и ЕДБ ${dbEdb(f.edb) || '____'}, со седиште ${[f.address, f.city].filter(Boolean).join(', ') || '____'}. Приоритетна дејност: ${String(f.activity || '____').trim()}. Одговорно лице: ${f.signer || '____'}.`;
  if (id === 'osn')
    return `Финансиските извештаи за ${Y} година се составени во согласност со Законот за трговските друштва и Правилникот за водење сметководство, применувајќи ги Меѓународните стандарди за финансиско известување за мали и средни субјекти, објавени во „Службен весник“. Износите се искажани во денари (МКД), без дени. Податоците за ${Y - 1} година се прикажани заради споредба.`;
  if (id === 'pol')
    return 'Материјалните и нематеријалните средства се евидентирани по набавна вредност намалена за акумулираната амортизација; амортизацијата се пресметува пропорционално, по стапките од Номенклатурата на средствата за амортизација. Залихите се вреднуваат по набавна вредност (просечна цена), односно по пониската од набавната и нето продажната вредност. Побарувањата се искажани по номинална вредност намалена за исправката за ненаплатливи побарувања. Паричните средства ги опфаќаат готовината во благајна и средствата на трансакциските сметки. Приходите се признаваат кога е извршена испораката, односно услугата. Ставките во странска валута се преведени по средниот курс на НБРСМ на денот на билансот.';
  if (id === 'nd') return 'По датумот на билансот на состојба до датумот на составување на финансиските извештаи нема настани кои би имале значајно влијание врз финансиските извештаи.';
  return '';
}

export interface BelResolved {
  id: string;
  no: number;
  title: string;
  rows: { rep: 'bs' | 'bu'; aop: string; label: string; cur: number; prev: number }[];
  text: string;
  /** the text was typed for this year (not automatic / carried from last year) */
  saved: boolean;
  auto: string;
}

/**
 * Resolve every note for printing/editing (legacy `belHTML`). Rows after the first are shown only when the
 * current or previous amount is at least 1 denar.
 */
export function belResolve(
  f: BelFirm,
  Y: number,
  cur: Readonly<Record<string, number>>,
  prev: Readonly<Record<string, number>>,
  notes: Readonly<Record<string, string>> | null | undefined,
  prevNotes: Readonly<Record<string, string>> | null | undefined,
): BelResolved[] {
  const N = notes ?? {};
  const NP = prevNotes ?? {};
  return BEL.map(([id, title, rows], i) => {
    const auto = belAuto(id, f, Y);
    const text = N[id] != null ? N[id]! : NP[id] != null && !['gen', 'osn'].includes(id) ? NP[id]! : auto;
    const R = (rows ?? [])
      .map(([rep, aop, label]) => ({ rep, aop, label, cur: Math.round(cur[rep + aop] || 0), prev: Math.round(prev[rep + aop] || 0) }))
      .filter((r, j) => j === 0 || Math.abs(r.cur) + Math.abs(r.prev) >= 1);
    return { id, no: i + 1, title, rows: R, text, saved: N[id] != null, auto };
  });
}
