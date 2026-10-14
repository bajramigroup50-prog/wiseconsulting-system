/**
 * „Законска усогласеност“ — one row per legal obligation of a firm, computed from facts the database layer
 * gathers (`complianceFacts` in @wise/db). Pure: the same facts always give the same rows.
 * Status: ok ✓, warn ⚠, bad ✗, na (does not apply), todo (needs a manual confirmation).
 */
import type { LegalIssue } from './invoice-rules';
import type { NumberingIssue } from './numbering';
import { CASH_LIMIT_EUR, CASH_LIMIT_MONTH, CASH_LIMIT_SINGLE, MIN_WAGE_LAW, VAT_MONTHLY_THRESHOLD, VAT_REGISTRATION_THRESHOLD } from './rules';

export type CmpStatus = 'ok' | 'warn' | 'bad' | 'na' | 'todo';
export const CMP_MARK: Readonly<Record<CmpStatus, string>> = { ok: '✓', warn: '⚠', bad: '✗', na: '–', todo: '?' };

export interface CmpRow { id: string; area: string; title: string; law: string; s: CmpStatus; txt: string; go?: string }

export interface ComplianceFacts {
  today: string;
  year: number;
  firm: { name: string; edb?: string | null; address?: string | null; city?: string | null; vatRegistered: boolean; vatPeriod: string; lockDate?: string | null; officeFirm?: boolean };
  /** Turnover of the previous year in denars (revenue accounts 7x), null = unknown. */
  turnoverPrev?: number | null;
  /** Invoices of the year with their legal issues (only those with at least one issue need to be passed). */
  invoiceIssues: readonly { number: string; date: string; issues: readonly LegalIssue[] }[];
  invoiceCount: number;
  numbering: readonly NumberingIssue[];
  cancelledCount: number;
  /** VAT periods of the year whose filing deadline passed without a closed return. */
  vatMissing: readonly string[];
  /** Payroll months of the year after the first employee without a calculated payroll. */
  payrollMissing: readonly string[] | null;
  /** Employees whose wage the engine raised to the statutory minimum in the last run (informative). */
  payrollRaised: number;
  /** `overEur`: cash receipts / payments above 1.000 € (ЗСППФТ чл. 58). */
  cash: { single: number; monthly: readonly string[]; negativeDays: number; overEur?: number } | null;
  /** Signed contract on accounting services with the client (Закон за вршење сметководствени работи). */
  serviceContract: boolean | null;
  /** Signed data processing agreement with the client (ЗЗЛП чл. 32). */
  dpa: boolean;
  /** Processing activities recorded for the firm. */
  activities: number;
  dsrOpen: number; dsrOverdue: number;
  breachOpen: number; breachOverdue: number;
  /** The database trigger that keeps the audit log append-only is installed. */
  auditImmutable: boolean;
  /** Open inspection deadlines: expired / within 3 days. */
  kontrolaExpired: number; kontrolaUrgent: number; kontrolaOpen: number;
  /** The nearest open inspection deadline (days left, negative = expired). */
  kontrolaNext?: { due: string; days: number; name: string } | null;
  /** Corrective actions past their due date. */
  actionsOverdue: number;
  /** Inspection readiness score (existing `insp` checklist), null = not computed. */
  inspScore?: { pct: number; bad: number } | null;
}

const ok = (txt: string): Pick<CmpRow, 's' | 'txt'> => ({ s: 'ok', txt });

export function complianceRows(F: ComplianceFacts): CmpRow[] {
  const R: CmpRow[] = [];
  const add = (id: string, area: string, title: string, law: string, r: Pick<CmpRow, 's' | 'txt'>, go?: string) => R.push({ id, area, title, law, ...r, go });
  const y = String(F.year);

  // ---------- firm data / books ----------
  const miss = [!F.firm.edb && 'ЕДБ', !F.firm.address && !F.firm.city && 'адреса'].filter(Boolean);
  add('firm', 'Книги', 'Податоци за фирмата на документите (назив, адреса, ЕДБ)', 'ЗДДВ чл. 53 ст. 10 т. 2 (назив, адреса и ДДВ број на издавачот)',
    miss.length ? { s: 'bad', txt: `Недостасува: ${miss.join(', ')} – фактурите не ги содржат задолжителните елементи.` } : ok('Комплетни.'), 'firmi');
  const prevEnd = `${F.year - 1}-12-31`;
  add('lock', 'Книги', 'Заклучување на претходната година по поднесување на годишната сметка', 'Закон за трговските друштва – годишна сметка (електронски) до 15 март (ЦРМ); по поднесувањето книгите не се менуваат',
    F.firm.lockDate && F.firm.lockDate >= prevEnd ? ok(`Книгите се заклучени до ${F.firm.lockDate.split('-').reverse().join('.')}.`)
      : F.today > `${F.year}-03-15` ? { s: 'warn', txt: `${F.year - 1} не е заклучена по рокот за годишната сметка – книжењата во неа сè уште може да се менуваат.` }
        : { s: 'todo', txt: `${F.year - 1} ќе се заклучи по поднесувањето на годишната сметка (до 15.03.${F.year}).` }, 'firmi');
  add('audit', 'Книги', 'Неменлив дневник на активности (кој, кога, што)', 'ЗДП чл. 48 (чување на книгите и документите); ЗЗЛП чл. 36 (безбедност на обработката)',
    F.auditImmutable ? ok('Дневникот е само за додавање – базата не дозволува измена или бришење.') : { s: 'bad', txt: 'Заштитата на дневникот не е инсталирана во базата (миграција).' }, 'aktivnost');

  // ---------- invoices ----------
  const blk = F.invoiceIssues.filter((i) => i.issues.some((x) => x.sev === 'block'));
  const wrn = F.invoiceIssues.filter((i) => !i.issues.some((x) => x.sev === 'block') && i.issues.length);
  add('inv_elements', 'Фактури', 'Задолжителни елементи на излезните фактури', 'ЗДДВ чл. 53 ст. 6, 8, 10',
    !F.invoiceCount ? { s: 'na', txt: `Нема излезни фактури во ${y}.` }
      : blk.length ? { s: 'bad', txt: `${blk.length} фактури без задолжителен елемент (пр. ${blk[0]!.number}: ${blk[0]!.issues.find((x) => x.sev === 'block')!.text})` }
        : wrn.length ? { s: 'warn', txt: `${wrn.length} фактури за проверка (пр. ${wrn[0]!.number}: ${wrn[0]!.issues[0]!.text})` }
          : ok(`Сите ${F.invoiceCount} фактури ги содржат задолжителните елементи.`), 'izlez');
  const gaps = F.numbering.filter((n) => n.code === 'gap' || n.code === 'duplicate' || n.code === 'unparsable');
  const order = F.numbering.filter((n) => n.code === 'order');
  add('inv_numbering', 'Фактури', 'Реден број по ред, без прескокнување, по година и серија', 'ЗДДВ чл. 53 ст. 10 т. 1 (број на фактурата); уредно водење на книгите (ЗДП) – последователноста е професионален стандард, за потврда',
    !F.invoiceCount ? { s: 'na', txt: '' } : gaps.length ? { s: 'warn', txt: gaps.map((g) => g.text).join(' ') }
      : order.length ? { s: 'warn', txt: order.map((g) => g.text).join(' ') } : ok(`Нумерацијата е по ред${F.cancelledCount ? ` (${F.cancelledCount} сторнирани – бројот е зачуван)` : ''}.`), 'izlez');

  // ---------- VAT ----------
  if (!F.firm.vatRegistered) {
    add('vat_reg', 'ДДВ', 'Задолжителна регистрација за ДДВ', VAT_REGISTRATION_THRESHOLD.law,
      F.turnoverPrev == null ? { s: 'todo', txt: 'Прометот од претходната година не е познат.' }
        : F.turnoverPrev > VAT_REGISTRATION_THRESHOLD.value ? { s: 'bad', txt: `Прометот во ${F.year - 1} (${Math.round(F.turnoverPrev).toLocaleString('mk-MK')} ден.) е над прагот од ${VAT_REGISTRATION_THRESHOLD.value.toLocaleString('mk-MK')} ден. – фирмата мора да се регистрира за ДДВ.` }
          : ok('Прометот е под прагот за задолжителна регистрација.'), 'firmi');
  } else {
    const shouldMonth = F.turnoverPrev != null && F.turnoverPrev > VAT_MONTHLY_THRESHOLD.value;
    add('vat_period', 'ДДВ', 'Даночен период (месечно / тримесечно) според прометот', VAT_MONTHLY_THRESHOLD.law,
      F.turnoverPrev == null ? { s: 'todo', txt: `Периодот е „${F.firm.vatPeriod === 'month' ? 'месец' : 'тримесечје'}“; прометот од претходната година не е познат.` }
        : shouldMonth && F.firm.vatPeriod !== 'month' ? { s: 'bad', txt: `Прометот во ${F.year - 1} е над 25.000.000 ден. – даночниот период мора да е месец.` }
          : !shouldMonth && F.firm.vatPeriod === 'month' ? { s: 'warn', txt: 'Прометот е под 25.000.000 ден. – периодот може да е тримесечје (освен ако УЈП определила месец).' }
            : ok(`Периодот „${F.firm.vatPeriod === 'month' ? 'месец' : 'тримесечје'}“ одговара на прометот.`), 'firmi');
    add('vat_filed', 'ДДВ', 'ДДВ-04 поднесена и затворена до 25-ти по периодот', 'ЗДДВ чл. 41 (пријава во 25 дена по периодот, и кога е нула), чл. 43 (плаќање)',
      F.vatMissing.length ? { s: 'bad', txt: `Не е затворена ДДВ-04 за: ${F.vatMissing.join(', ')}.` } : ok('Сите поминати периоди се затворени.'), 'ddv');
  }

  // ---------- payroll ----------
  add('payroll', 'Плата', 'Плата пресметана за секој месец (МПИН до 10-ти)', 'ЗПЗСО чл. 18 (МПИН до 10-ти), чл. 22 (пресметка до вработениот во 15 дена)',
    F.payrollMissing == null ? { s: 'na', txt: 'Фирмата нема вработени.' } : F.payrollMissing.length ? { s: 'bad', txt: `Нема пресметана плата за: ${F.payrollMissing.join(', ')}.` } : ok('Пресметана за секој месец.'), 'plati');
  add('min_wage', 'Плата', 'Плата најмалку минималната плата', MIN_WAGE_LAW,
    F.payrollMissing == null ? { s: 'na', txt: '' } : F.payrollRaised ? { s: 'warn', txt: `Кај ${F.payrollRaised} вработени договорената плата е под минималната – програмата ја пресметува минималната; усогласете ги договорите.` } : ok('Ниту една плата не е под минималната.'), 'plati');

  // ---------- cash ----------
  add('cash', 'Готовина', 'Готовински плаќања во дозволените граници и благајна без минус', `${CASH_LIMIT_SINGLE.law}; ${CASH_LIMIT_MONTH.law}; ${CASH_LIMIT_EUR.law}`,
    F.cash == null ? { s: 'na', txt: 'Нема благајнички промет.' }
      : F.cash.single || F.cash.monthly.length || F.cash.negativeDays || F.cash.overEur ? { s: 'bad', txt: [F.cash.overEur ? `${F.cash.overEur} готовински трансакции над 1.000 €` : '', F.cash.single ? `${F.cash.single} плаќања над ${CASH_LIMIT_SINGLE.value.toLocaleString('mk-MK')} ден.` : '', F.cash.monthly.length ? `месеци над ${CASH_LIMIT_MONTH.value.toLocaleString('mk-MK')} ден.: ${F.cash.monthly.join(', ')}` : '', F.cash.negativeDays ? `благајна во минус ${F.cash.negativeDays} дена` : ''].filter(Boolean).join('; ') }
        : ok('Во границите.'), 'blagajna');

  // ---------- office / data protection ----------
  if (!F.firm.officeFirm) {
    add('contract', 'Канцеларија', 'Писмен договор за сметководствени услуги со клиентот', 'Закон за вршење сметководствени работи (Сл. весник 173/2022, 47/2025), чл. 31 ст. 8–13; глоба чл. 52 (500–3.000 €)',
      F.serviceContract == null ? { s: 'todo', txt: 'Потврдете дека постои потпишан договор.' } : F.serviceContract ? ok('Евидентиран договор.') : { s: 'bad', txt: 'Нема евидентиран договор за сметководствени услуги.' }, 'kdogovori');
    add('dpa', 'Лични податоци', 'Договор за обработка на лични податоци (канцеларијата како обработувач)', 'ЗЗЛП чл. 32 (договор со обработувачот)',
      F.dpa ? ok('Потпишан.') : { s: 'bad', txt: 'Нема потпишан договор за обработка на лични податоци со клиентот.' }, 'zzlp');
  }
  add('ropa', 'Лични податоци', 'Евиденција на активностите за обработка', 'ЗЗЛП чл. 34 (евиденција на активностите за обработка)',
    F.activities ? ok(`${F.activities} активности евидентирани.`) : { s: 'warn', txt: 'Нема евидентирани активности за обработка – додајте ги стандардните.' }, 'zakon#ropa');
  add('dsr', 'Лични податоци', 'Барања од субјекти одговорени во рок од еден месец; инциденти пријавени во 72 часа', 'ЗЗЛП чл. 16 (одговор во рок од еден месец), чл. 37 (пријава на повреда во 72 часа)',
    F.dsrOverdue || F.breachOverdue ? { s: 'bad', txt: `Задоцнети: ${F.dsrOverdue} барања, ${F.breachOverdue} инциденти.` }
      : F.dsrOpen || F.breachOpen ? { s: 'warn', txt: `Отворени: ${F.dsrOpen} барања, ${F.breachOpen} инциденти (во рок).` } : ok('Нема отворени барања / инциденти.'), 'zakon#dsr');

  // ---------- inspections ----------
  add('kontrola', 'Контроли', 'Рокови за приговор / жалба по контроли', 'ЗОУП чл. 106 (жалба 15 дена); ЗИН чл. 82, 84; ЗДП чл. 102, 111; ЗЗЛП чл. 107',
    F.kontrolaExpired ? { s: 'bad', txt: `${F.kontrolaExpired} истечени рокови без поднесок.` } : F.kontrolaUrgent ? { s: 'warn', txt: `${F.kontrolaUrgent} рокови истекуваат за ≤ 3 дена.` }
      : F.kontrolaOpen ? ok(`${F.kontrolaOpen} отворени рокови, во рок.`) : ok('Нема отворени рокови.'), 'kontroli');
  if (F.kontrolaNext) {
    const r = R[R.length - 1]!;
    const n = F.kontrolaNext;
    r.txt += ` Најблизок рок: ${n.name} до ${n.due.split('-').reverse().join('.')} – ${n.days < 0 ? `истекол пред ${-n.days} дена` : n.days === 0 ? 'ДЕНЕС' : `уште ${n.days} ${n.days === 1 ? 'ден' : 'дена'}`}.`;
  }
  add('actions', 'Контроли', 'Корективни мерки по контроли – навремено извршени', 'Решенија на инспекциските органи (рок за отстранување)',
    F.actionsOverdue ? { s: 'bad', txt: `${F.actionsOverdue} мерки по рокот.` } : ok('Нема задоцнети мерки.'), 'kontroli');
  if (F.inspScore) add('insp', 'Контроли', 'Подготвеност за инспекција (УЈП / ДПИ / ДИТ)', 'види 🕵 Подготвеност за инспекција',
    F.inspScore.bad ? { s: 'bad', txt: `${F.inspScore.pct}% – ${F.inspScore.bad} неисполнети обврски.` } : F.inspScore.pct < 100 ? { s: 'warn', txt: `${F.inspScore.pct}% – има ставки за потврда.` } : ok('100%.'), 'insp');
  return R;
}

export function complianceScore(R: readonly CmpRow[]): { ok: number; warn: number; bad: number; todo: number; na: number; pct: number } {
  const c = (s: CmpStatus) => R.filter((r) => r.s === s).length;
  const app = R.length - c('na');
  return { ok: c('ok'), warn: c('warn'), bad: c('bad'), todo: c('todo'), na: c('na'), pct: app ? Math.round((100 * c('ok')) / app) : 100 };
}
