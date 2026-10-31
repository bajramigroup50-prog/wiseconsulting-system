/**
 * „📊 Извештаи“ – every report of the program in one place, by group. Each entry opens the existing screen at its own
 * address (its own access rules apply: the page lists only the views the user may open). `p` = the screen takes the
 * common period of the page (`from` / `to`). Pure (no DB, no Next imports).
 */
export interface ReportEntry {
  /** View (first path segment) of the address. */
  view: string;
  /** The menu view whose access rules apply when it is not `view` (the year-end screens follow „Завршна сметка“). */
  acc?: string;
  label: string;
  desc: string;
  /** Address when it is not `/<view>`. */
  href?: string;
  /** Takes `from` / `to`. */
  p?: boolean;
  /** Added with „📊 Извештаи“. */
  isNew?: boolean;
}

export const REPORT_GROUPS: readonly (readonly [string, readonly ReportEntry[]])[] = [
  ['🆕 Нови извештаи', [
    { view: 'izvestai', href: '/izvestai/starost', label: 'Старосна структура', desc: 'побарувања и обврски по комитент: во рок, 1–30, 31–60, 61–90, над 90 дена', isNew: true },
    { view: 'izvestai', href: '/izvestai/obvrski', label: 'Обврски кон УЈП и фондови', desc: 'по месеци: пресметано, платено и салдо за данок, придонеси, нето плати и ДДВ', isNew: true },
    { view: 'izvestai', href: '/izvestai/bu-mesec', label: 'Биланс на успех по месеци', desc: 'приходи, расходи по групи и резултат јан–дек, со споредба со претходната година', isNew: true },
  ]],
  ['Книговодство', [
    { view: 'bilanc', label: 'Бруто биланс', desc: 'класи, синтетики, аналитики, рекапитулар; Заклучен лист', p: true },
    { view: 'akart', label: 'Аналитика', desc: 'избор на конто → комитенти → картица', p: true },
    { view: 'kkart', label: 'Аналитичка картица по конто', desc: 'сите ставки на едно конто' },
    { view: 'kartici', label: 'Картици по комитент', desc: 'картица, синтетика, ИОС, потврда на салдо', p: true },
    { view: 'analitika', label: 'Аналитика на партнери (ИОС)', desc: 'промет и салдо по комитент на 12… / 22…' },
    { view: 'recFree', label: 'Споредба на две картици', desc: 'нашата картица наспроти картицата на партнерот' },
    { view: 'poobjekti', label: 'Резултат по објекти', desc: 'приходи / расходи по магацин / продавница', p: true },
    { view: 'nalozi', label: 'Налози за книжење', desc: 'налози и дневник на книжења' },
    { view: 'vnes', label: 'Преглед на внес по месеци', desc: 'што фали по месеци (фактури, изводи, скенирани)' },
    { view: 'pocetna', label: 'Почетна состојба', desc: 'салда на почетокот на годината' },
    { view: 'bkAdv', label: 'Плаќања без фактура', desc: 'аванси и уплати неповрзани со фактура' },
    { view: 'kamati', label: 'Казнена камата', desc: 'камата за задоцнети фактури' },
    { view: 'pozajmici', label: 'Позајмици и заеми', desc: 'договори, отплати, салдо' },
  ]],
  ['ДДВ и даноци', [
    { view: 'ddv', label: 'ДДВ-04', desc: 'периоди, пријава и прилог' },
    { view: 'ddvKnigi', label: 'Книги за ДДВ', desc: 'влезни и излезни фактури' },
    { view: 'lawrep', label: 'Даночен преглед', desc: 'прелиминарен даночен преглед' },
    { view: 'insp', label: 'Подготвеност за инспекција', desc: 'листа за проверка пред контрола' },
    { view: 'kontroli', label: 'Контроли и решенија', desc: 'анализа на даночни контроли' },
  ]],
  ['Банка и благајна', [
    { view: 'banka', label: 'Изводи (денарски)', desc: 'изводи, преглед за книжење' },
    { view: 'devizni', label: 'Девизни изводи', desc: 'изводи во девизи' },
    { view: 'blagajna', label: 'Благајна', desc: 'благајнички дневник', p: true },
    { view: 'ppNal', label: 'Платни налози', desc: 'ПП30 / ПП50 / ПП10' },
    { view: 'kompenzacii', label: 'Компензации', desc: 'пребивања меѓу комитенти' },
    { view: 'fiskPer', label: 'Фискални извештаи', desc: 'дневен промет од каса', p: true },
  ]],
  ['Плати', [
    { view: 'plati', label: 'Пресметка на плата', desc: 'пресметка, платни листи' },
    { view: 'payGod', label: 'Годишен извештај', desc: 'плати по вработен за годината' },
    { view: 'payM4', label: 'М4 образец', desc: 'годишен М4' },
    { view: 'pdd', label: 'Закупнина, бонуси и услуги', desc: 'исплати на физички лица (ПДД)' },
  ]],
  ['Продажба, набавки, комитенти', [
    { view: 'izlez', label: 'Излезни фактури', desc: 'листа на издадени фактури' },
    { view: 'uslugi', label: 'Услуги', desc: 'фактури за услуги' },
    { view: 'vlez', label: 'Влезни фактури', desc: 'листа на примени фактури' },
    { view: 'opomeni', label: 'Неплатени фактури и опомени', desc: 'доспеани побарувања, опомени' },
    { view: 'analizi', label: 'Анализи', desc: 'продажба, артикли, комитенти, паричен тек, показатели, сезона' },
    { view: 'klDash', label: 'Табла – анализа на работењето', desc: 'промет, трошоци, побарувања по месеци' },
  ]],
  ['Залиха, магацин, малопродажба', [
    { view: 'g_lager', label: 'Лагер листа', desc: 'состојба на залиха' },
    { view: 'g_kartica', label: 'Материјална картица', desc: 'картица на артикл' },
    { view: 'g_trg', label: 'Количинска евиденција', desc: 'по артикл' },
    { view: 'g_trgv', label: 'Трговска книга на големо (ЕТ)', desc: 'вредносна евиденција' },
    { view: 'm_lager', label: 'Лагер листа – малопродажба', desc: 'состојба во продавница' },
    { view: 'm_kartica', label: 'Картица на производ', desc: 'малопродажба' },
    { view: 'm_trg', label: 'МЕТГ', desc: 'евиденција во трговијата на мало' },
    { view: 'kdfi', label: 'КДФИ-01', desc: 'дневни фискални извештаи', p: true },
    { view: 'zaliha', label: 'Приемници и издатници', desc: 'документи за залиха' },
  ]],
  ['Основни средства', [
    { view: 'os', label: 'Регистар и амортизација', desc: 'основни средства, амортизација, картони' },
  ]],
  ['Завршна сметка', [
    { view: 'zsProc', label: 'Завршна сметка – по фази', desc: 'преглед на сите чекори' },
    { view: 'zs_bs', acc: 'zsProc', label: 'Биланс на состојба', desc: 'АОП' },
    { view: 'zs_bu', acc: 'zsProc', label: 'Биланс на успех', desc: 'АОП' },
    { view: 'zs_db', acc: 'zsProc', label: 'Даночен биланс (ДБ)', desc: 'данок на добивка' },
    { view: 'zs_aop', acc: 'zsProc', label: 'АОП позиции', desc: 'тековна наспроти претходна година' },
    { view: 'zsKontrola', acc: 'zsProc', label: 'Контрола на завршна сметка', desc: 'проверки пред поднесување' },
  ]],
  ['Канцеларија', [
    { view: 'firmIzv', label: 'Целосен извештај за фирма', desc: 'сè за една фирма на едно место' },
    { view: 'mesIzv', label: 'Месечен извештај за клиентот', desc: 'извештај што се праќа на клиентот' },
    { view: 'produktivnost', label: 'Продуктивност', desc: 'работа на вработените по период' },
    { view: 'zatvoranje', label: 'Месечно затворање', desc: 'состојба по сите фирми' },
  ]],
];

/** All entries (flat) with their group. */
export const REPORTS: readonly (ReportEntry & { group: string })[] = REPORT_GROUPS.flatMap(([group, L]) => L.map((r) => ({ ...r, group })));

/** Address of a report with the common period (only for the screens that take it). */
export function reportHref(r: ReportEntry, from?: string, to?: string): string {
  const base = r.href ?? '/' + r.view;
  if (!r.p || !from || !to) return base;
  return `${base}${base.includes('?') ? '&' : '?'}from=${from}&to=${to}`;
}
