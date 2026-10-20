/**
 * ISO – квалитет (the office itself working by ISO 9001 quality, ISO 27001 information security, ISO 10001 / 10002
 * customer code of conduct and complaints): the registers the certifier asks for, their fields, numbering, the
 * overview and the management review (ISO 9001 §9.3). Pure – storage in @wise/db `iso_records`.
 */

export type IsoKind = 'complaint' | 'nc' | 'risk' | 'audit' | 'training' | 'incident' | 'objective' | 'policy';
export type IsoStatus = 'open' | 'progress' | 'done';
export interface IsoField { k: string; n: string; t?: 'text' | 'area' | 'date' | 'num' | 'sel'; o?: readonly string[] }
export interface IsoKindDef { k: IsoKind; n: string; one: string; clause: string; ic: string; prefix: string; fields: readonly IsoField[]; hint: string }

export const ISO_KINDS: readonly IsoKindDef[] = [
  {
    k: 'complaint', n: 'Поплаки и приговори', one: 'Поплака', clause: 'ISO 10002 · ISO 9001 §9.1.2', ic: '📣', prefix: 'ПП',
    hint: 'Секоја поплака на клиент (за услуга, грешка, рок, однесување): прием → анализа → одговор → задоволство на клиентот.',
    fields: [
      { k: 'from', n: 'Подносител (клиент / лице)' }, { k: 'channel', n: 'Начин на прием', t: 'sel', o: ['е-пошта', 'телефон', 'лично', 'портал', 'писмо', 'друго'] },
      { k: 'desc', n: 'Опис на поплаката', t: 'area' }, { k: 'cause', n: 'Анализа – причина', t: 'area' },
      { k: 'action', n: 'Преземено / одговор до клиентот', t: 'area' }, { k: 'satisfied', n: 'Клиентот задоволен', t: 'sel', o: ['', 'да', 'делумно', 'не'] },
    ],
  },
  {
    k: 'nc', n: 'Неусогласености и корективни мерки', one: 'Неусогласеност', clause: 'ISO 9001 §10.2 · ISO 27001 §10.2', ic: '🛠', prefix: 'НК',
    hint: 'Грешка во работата, пропуштен рок, наод од проверка: корекција веднаш, причина, корективна мерка да не се повтори, проверка на ефективноста.',
    fields: [
      { k: 'source', n: 'Извор', t: 'sel', o: ['внатрешна проверка', 'поплака', 'грешка во работата', 'пропуштен рок', 'инцидент', 'надворешна проверка', 'друго'] },
      { k: 'desc', n: 'Опис', t: 'area' }, { k: 'correction', n: 'Корекција (веднаш)', t: 'area' }, { k: 'cause', n: 'Причина (анализа)', t: 'area' },
      { k: 'corrective', n: 'Корективна мерка', t: 'area' }, { k: 'verified', n: 'Проверка на ефективноста', t: 'area' },
    ],
  },
  {
    k: 'risk', n: 'Ризици и можности', one: 'Ризик', clause: 'ISO 9001 §6.1 · ISO 27001 §6.1.2', ic: '🎯', prefix: 'РЗ',
    hint: 'Што може да тргне наопаку (пропуштен рок, губење податоци, отсуство на вработен…) – веројатност × влијание, мерка.',
    fields: [
      { k: 'area', n: 'Област', t: 'sel', o: ['рокови и пријави', 'податоци и безбедност', 'кадар', 'клиенти', 'законски промени', 'ИТ систем', 'финансии', 'друго'] },
      { k: 'desc', n: 'Опис на ризикот', t: 'area' }, { k: 'p', n: 'Веројатност (1–5)', t: 'num' }, { k: 'i', n: 'Влијание (1–5)', t: 'num' },
      { k: 'treatment', n: 'Мерка (третман)', t: 'area' }, { k: 'residual', n: 'Преостанат ризик (1–25)', t: 'num' },
    ],
  },
  {
    k: 'audit', n: 'Внатрешни проверки', one: 'Проверка', clause: 'ISO 9001 §9.2 · ISO 27001 §9.2', ic: '🔍', prefix: 'ВП',
    hint: 'Најмалку еднаш годишно: опфат, проверувач, наоди; секој наод станува неусогласеност со корективна мерка.',
    fields: [
      { k: 'scope', n: 'Опфат (процеси / клаузули)', t: 'area' }, { k: 'auditor', n: 'Проверувач' }, { k: 'date', n: 'Датум на проверка', t: 'date' },
      { k: 'findings', n: 'Наоди', t: 'area' }, { k: 'conclusion', n: 'Заклучок', t: 'area' },
    ],
  },
  {
    k: 'training', n: 'Обуки и компетентност', one: 'Обука', clause: 'ISO 9001 §7.2 · ISO 27001 §7.2–7.3', ic: '🎓', prefix: 'ОБ',
    hint: 'Обуки на вработените (законски измени, програмата, безбедност на податоци) со доказ.',
    fields: [
      { k: 'who', n: 'Вработен / учесници' }, { k: 'topic', n: 'Тема' }, { k: 'provider', n: 'Предавач / организатор' }, { k: 'date', n: 'Датум', t: 'date' },
      { k: 'hours', n: 'Часови', t: 'num' }, { k: 'evidence', n: 'Доказ (сертификат, листа…)' },
    ],
  },
  {
    k: 'incident', n: 'Безбедносни инциденти', one: 'Инцидент', clause: 'ISO 27001 A.5.24–A.5.28 · ЗЗЛП чл. 37', ic: '🛡', prefix: 'ИН',
    hint: 'Изгубен уред, погрешно испратен документ, неовластен пристап, пад на системот: што се случило, податоци, мерки, известување (АЗЛП во 72 часа).',
    fields: [
      { k: 'when', n: 'Кога се случило', t: 'date' }, { k: 'desc', n: 'Опис', t: 'area' }, { k: 'data', n: 'Засегнати податоци / клиенти' },
      { k: 'action', n: 'Преземени мерки', t: 'area' }, { k: 'notified', n: 'Известување (АЗЛП / клиенти)', t: 'sel', o: ['', 'не е потребно', 'известени во 72 ч.', 'известени подоцна', 'не се известени'] },
    ],
  },
  {
    k: 'objective', n: 'Цели на квалитетот', one: 'Цел', clause: 'ISO 9001 §6.2', ic: '🏁', prefix: 'ЦЛ',
    hint: 'Мерливи цели за годината (пр. 100% пријави во рок, поплаки < 3, одговор на клиент за 2 работни дена).',
    fields: [
      { k: 'target', n: 'Цел (мерливо)' }, { k: 'measure', n: 'Како се мери' }, { k: 'value', n: 'Постигнато' },
    ],
  },
  {
    k: 'policy', n: 'Политики и документи', one: 'Документ', clause: 'ISO 9001 §5.2, §7.5 · ISO 27001 §5.2', ic: '📘', prefix: 'ДК',
    hint: 'Политиките и постапките на канцеларијата – верзија, одобрил, датум; важечката верзија е секогаш тука.',
    fields: [
      { k: 'version', n: 'Верзија' }, { k: 'approvedBy', n: 'Одобрил' }, { k: 'approvedOn', n: 'Одобрено на', t: 'date' }, { k: 'text', n: 'Текст', t: 'area' },
    ],
  },
];
export const isoKind = (k: string) => ISO_KINDS.find((x) => x.k === k);
export const ISO_STATUS: Record<IsoStatus, string> = { open: 'отворено', progress: 'во работа', done: 'затворено' };

/** „ПП-3/26“ – prefix, serial per kind and year. */
export const isoNo = (kind: IsoKind, no: number, year: number) => `${isoKind(kind)?.prefix ?? '??'}-${no}/${String(year).slice(2)}`;

/** Risk score p × i (1–25) and its class. */
export function riskScore(d: Record<string, unknown>): { s: number; cls: 'low' | 'mid' | 'high' } | null {
  const p = Number(d.p), i = Number(d.i);
  if (!(p >= 1 && p <= 5 && i >= 1 && i <= 5)) return null;
  const s = p * i;
  return { s, cls: s >= 15 ? 'high' : s >= 8 ? 'mid' : 'low' };
}

export interface IsoRow { id: string; kind: IsoKind; no: number; year: number; title: string; status: IsoStatus; due: string | null; created: string; closed: string | null; data: Record<string, unknown> }

/** Per register: total, open, overdue (open past the due date). */
export function isoOverview(R: readonly IsoRow[], today: string) {
  return ISO_KINDS.map((d) => {
    const L = R.filter((r) => r.kind === d.k);
    const open = L.filter((r) => r.status !== 'done');
    return { k: d.k, total: L.length, open: open.length, late: open.filter((r) => r.due && r.due < today).length };
  });
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** The numbers of the management review (ISO 9001 §9.3.2) for one year. */
export function isoReview(R: readonly IsoRow[], year: number) {
  const Y = R.filter((r) => r.year === year);
  const of = (k: IsoKind) => Y.filter((r) => r.kind === k);
  const C = of('complaint'), closedC = C.filter((r) => r.status === 'done' && r.closed);
  const avg = closedC.length ? Math.round(closedC.reduce((s, r) => s + days(r.created.slice(0, 10), r.closed!.slice(0, 10)), 0) / closedC.length * 10) / 10 : null;
  const sat = C.filter((r) => r.data.satisfied === 'да').length, satAsked = C.filter((r) => r.data.satisfied).length;
  const risks = R.filter((r) => r.kind === 'risk' && r.status !== 'done').map((r) => ({ r, sc: riskScore(r.data) })).sort((a, b) => (b.sc?.s ?? 0) - (a.sc?.s ?? 0));
  return {
    complaints: { n: C.length, closed: closedC.length, avgDays: avg, satisfied: satAsked ? Math.round(sat / satAsked * 100) : null },
    nc: { n: of('nc').length, open: of('nc').filter((r) => r.status !== 'done').length, bySource: countBy(of('nc'), 'source') },
    audits: of('audit'),
    risks: { open: risks.length, high: risks.filter((x) => x.sc?.cls === 'high'), list: risks.slice(0, 10) },
    objectives: R.filter((r) => r.kind === 'objective' && (r.year === year || r.status !== 'done')),
    trainings: { n: of('training').length, hours: of('training').reduce((s, r) => s + (Number(r.data.hours) || 0), 0) },
    incidents: { n: of('incident').length, notified: of('incident').filter((r) => String(r.data.notified ?? '').startsWith('известени')).length },
    policies: R.filter((r) => r.kind === 'policy'),
  };
}
function countBy(L: readonly IsoRow[], k: string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of L) { const v = String(r.data[k] ?? '') || '—'; m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]);
}

/**
 * The starting documents of the office (policies and procedures, Macedonian), filled with its name – „📘 Креирај ги
 * основните документи“ adds the ones not there yet (by title); the office edits and approves them.
 */
export function isoStarterDocs(office: string): { title: string; text: string }[] {
  const o = office || 'Канцеларијата';
  return [
    { title: 'Политика на квалитет', text: `${o} обезбедува сметководствени, даночни и советодавни услуги кои се точни, навремени и во согласност со законите на Република Северна Македонија.\n\nСе обврзуваме:\n1. Секоја пријава, исплата и извештај на клиентите да биде поднесен во законскиот рок.\n2. Книжењето да биде проверено пред затворање на периодот (физичка проверка на документите, усогласување на картиците).\n3. Секоја поплака на клиент да ја евидентираме и одговориме најдоцна за 2 работни дена.\n4. Вработените постојано да се обучуваат за законските измени.\n5. Да ги следиме целите на квалитетот и да го подобруваме системот (ISO 9001).\n\nПолитиката е соопштена на сите вработени и е достапна за клиентите.` },
    { title: 'Политика за безбедност на информациите', text: `${o} ги чува деловните и личните податоци на клиентите доверливи, интегрални и достапни (ISO 27001, Закон за заштита на личните податоци).\n\n1. Пристап до податоците имаат само овластени корисници, секој со своја лозинка и улога; пристапот се укинува веднаш по престанок на работа.\n2. Секоја промена во книгите се евидентира (дневник на промени) и не може да се избрише.\n3. Податоците се чуваат на сервер со дневна резервна копија; враќањето од копија се проверува најмалку двапати годишно.\n4. Документите се праќаат само на проверени адреси на клиентот; лозинки и пристапни податоци не се праќаат по е-пошта.\n5. Секој инцидент (изгубен уред, погрешно испратен документ, сомнителен пристап) веднаш се пријавува и евидентира; засегнатите и АЗЛП се известуваат во 72 часа кога е потребно.` },
    { title: 'Кодекс на однесување кон клиентите (ISO 10001)', text: `Обврски на ${o} кон секој клиент:\n1. Одговор на барање или прашање – најдоцна следниот работен ден.\n2. Известување за рок што се приближува (ДДВ, плати, годишна сметка) најмалку 5 дена однапред.\n3. Список на документи што недостасуваат – еднаш месечно, писмено.\n4. Јасна цена на услугите однапред; без скриени трошоци.\n5. Доверливост на сите податоци на клиентот.\n6. Секоја поплака се евидентира и се решава според Постапката за поплаки.` },
    { title: 'Постапка за поплаки (ISO 10002)', text: `1. Прием: поплаката се прима по секој канал (е-пошта, телефон, лично, портал) и веднаш се внесува во регистарот „Поплаки и приговори“.\n2. Потврда до клиентот во рок од 1 работен ден.\n3. Анализа на причината – одговорното лице.\n4. Одговор и решение – најдоцна за 2 работни дена (сложени случаи: 8 дена, со известување).\n5. Прашање до клиентот дали е задоволен; одговорот се запишува.\n6. Ако причината е во нашата работа – се отвора неусогласеност со корективна мерка.\n7. Поплаките се анализираат на Прегледот од раководството.` },
    { title: 'Постапка за неусогласености и корективни мерки', text: `1. Секоја грешка, пропуштен рок, наод од проверка или поплака од наша вина се внесува во „Неусогласености и корективни мерки“.\n2. Корекција – веднаш (исправка на книжење, дополнителна пријава…).\n3. Анализа на причината (зошто се случи).\n4. Корективна мерка за да не се повтори, со одговорно лице и рок.\n5. По рокот – проверка на ефективноста; дури тогаш записот се затвора.` },
    { title: 'Постапка за пристап, лозинки и резервни копии', text: `1. Корисник се отвора само по одобрение на управителот, со најмала потребна улога.\n2. Лозинките се лични, не се споделуваат; се менуваат при сомнеж.\n3. При заминување на вработен пристапот се затвора истиот ден.\n4. Резервна копија на базата се прави автоматски секој ден и пред секоја надградба на програмата.\n5. Двапати годишно се проверува враќање од копија; резултатот се запишува во внатрешна проверка.\n6. Дневникот на промени и грешките на системот се прегледуваат месечно.` },
  ];
}
