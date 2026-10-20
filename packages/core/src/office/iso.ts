/**
 * ISO – квалитет (the office itself working by ISO 9001 quality, ISO 27001 information security, ISO 10001 / 10002
 * customer code of conduct and complaints, ISO/IEC 27701 + ЗЗЛП personal data, ISO 22301 business continuity): the
 * registers the certifier asks for, their fields, numbering, the overview and the management review (ISO 9001 §9.3).
 * Pure – storage in @wise/db `iso_records`.
 */

import { isoCertDocs, type IsoDoc } from './iso-docs';
export { ISO_DOC, isoCertDocs, type IsoDoc } from './iso-docs';

export type IsoKind = 'complaint' | 'nc' | 'risk' | 'audit' | 'auditplan' | 'training' | 'incident' | 'objective' | 'policy' | 'review' | 'supplier' | 'processing' | 'dsr' | 'dpia' | 'bcp' | 'bctest' | 'staff';
export type IsoStatus = 'open' | 'progress' | 'done';
/** `dt` – date and time (local Skopje, „2026-10-20T14:30“); `ref` – the id of a record of the register `ref`. */
export interface IsoField { k: string; n: string; t?: 'text' | 'area' | 'date' | 'dt' | 'num' | 'sel' | 'ref'; o?: readonly string[]; ref?: IsoKind }
/** The group of the overview: the quality system, personal data (27701), continuity (22301). */
export type IsoGroup = 'qms' | 'pims' | 'bcms';
/** `hidden` – kept in `iso_records` but shown on its own screen, not as an overview tile (the staff rows). */
export interface IsoKindDef { k: IsoKind; n: string; one: string; clause: string; ic: string; prefix: string; g: IsoGroup; fields: readonly IsoField[]; hint: string; hidden?: boolean }
/**
 * Keys of `data` the system writes besides the register's fields (kept on every save): `_sign` – the sign-off of the
 * responsible person {by, name, at}; `_rev` – the change history of a document [{v, on, by, note}].
 */
export const ISO_SYS_KEYS = ['_sign', '_rev'] as const;
export interface IsoSign { by: string; name: string; at: string }
export interface IsoRev { v: string; on: string; by: string; note?: string }
export const ISO_GROUPS: readonly { g: IsoGroup; n: string }[] = [
  { g: 'qms', n: 'ISO 9001 · ISO 27001 · ISO 10001 / 10002' },
  { g: 'pims', n: '🔐 ISO/IEC 27701 · Закон за заштита на личните податоци' },
  { g: 'bcms', n: '🧯 ISO 22301 – Континуитет на работењето' },
];
const DSR_T = ['пристап до податоците', 'исправка', 'бришење', 'ограничување на обработката', 'преносливост', 'приговор', 'повлекување на согласност'] as const;

export const ISO_KINDS: readonly IsoKindDef[] = [
  {
    k: 'complaint', n: 'Поплаки и приговори', one: 'Поплака', clause: 'ISO 10002 · ISO 9001 §9.1.2', ic: '📣', prefix: 'ПП', g: 'qms',
    hint: 'Секоја поплака на клиент (за услуга, грешка, рок, однесување): прием → анализа → одговор → задоволство на клиентот.',
    fields: [
      { k: 'from', n: 'Подносител (клиент / лице)' }, { k: 'channel', n: 'Начин на прием', t: 'sel', o: ['е-пошта', 'телефон', 'лично', 'портал', 'писмо', 'друго'] },
      { k: 'desc', n: 'Опис на поплаката', t: 'area' }, { k: 'cause', n: 'Анализа – причина', t: 'area' },
      { k: 'action', n: 'Преземено / одговор до клиентот', t: 'area' }, { k: 'satisfied', n: 'Клиентот задоволен', t: 'sel', o: ['', 'да', 'делумно', 'не'] },
    ],
  },
  {
    k: 'nc', n: 'Неусогласености и корективни мерки', one: 'Неусогласеност', clause: 'ISO 9001 §10.2 · ISO 27001 §10.2', ic: '🛠', prefix: 'НК', g: 'qms',
    hint: 'Грешка во работата, пропуштен рок, наод од проверка: корекција веднаш, причина, корективна мерка да не се повтори, проверка на ефективноста.',
    fields: [
      { k: 'source', n: 'Извор', t: 'sel', o: ['внатрешна проверка', 'поплака', 'грешка во работата', 'пропуштен рок', 'инцидент', 'надворешна проверка', 'друго'] },
      { k: 'desc', n: 'Опис', t: 'area' }, { k: 'correction', n: 'Корекција (веднаш)', t: 'area' }, { k: 'cause', n: 'Причина (анализа)', t: 'area' },
      { k: 'corrective', n: 'Корективна мерка', t: 'area' }, { k: 'verified', n: 'Проверка на ефективноста (што е проверено)', t: 'area' },
      { k: 'effective', n: 'Мерката е ефективна', t: 'sel', o: ['', 'да', 'не – нова мерка'] }, { k: 'verifiedBy', n: 'Ефективноста ја провери' }, { k: 'verifiedOn', n: 'Проверено на', t: 'date' },
    ],
  },
  {
    k: 'risk', n: 'Ризици и можности', one: 'Ризик', clause: 'ISO 9001 §6.1 · ISO 27001 §6.1.2', ic: '🎯', prefix: 'РЗ', g: 'qms',
    hint: 'Што може да тргне наопаку (пропуштен рок, губење податоци, отсуство на вработен…) – веројатност × влијание, мерка.',
    fields: [
      { k: 'area', n: 'Област', t: 'sel', o: ['рокови и пријави', 'податоци и безбедност', 'кадар', 'клиенти', 'законски промени', 'ИТ систем', 'финансии', 'друго'] },
      { k: 'desc', n: 'Опис на ризикот', t: 'area' }, { k: 'p', n: 'Веројатност (1–5)', t: 'num' }, { k: 'i', n: 'Влијание (1–5)', t: 'num' },
      { k: 'option', n: 'Опција за третман', t: 'sel', o: ['', 'намалување (контроли)', 'прифаќање', 'избегнување', 'пренесување (осигурување, договор)'] },
      { k: 'treatment', n: 'Мерка (третман)', t: 'area' }, { k: 'controls', n: 'Контроли од Анекс А (пр. A.8.13, A.5.15)' },
      { k: 'residual', n: 'Преостанат ризик (1–25)', t: 'num' }, { k: 'accepted', n: 'Преостанатиот ризик го прифати (сопственик на ризикот)' }, { k: 'acceptedOn', n: 'Прифатено на', t: 'date' },
    ],
  },
  {
    k: 'audit', n: 'Внатрешни проверки', one: 'Проверка', clause: 'ISO 9001 §9.2 · ISO 27001 §9.2', ic: '🔍', prefix: 'ВП', g: 'qms',
    hint: 'Најмалку еднаш годишно: опфат, проверувач, наоди; секој наод станува неусогласеност со корективна мерка.',
    fields: [
      { k: 'plan', n: 'Од програмата', t: 'ref', ref: 'auditplan' }, { k: 'scope', n: 'Опфат (процеси / клаузули)', t: 'area' }, { k: 'criteria', n: 'Критериуми (стандард, клаузули, постапки)' },
      { k: 'auditor', n: 'Проверувач' }, { k: 'independence', n: 'Независност', t: 'sel', o: ['', 'проверувачот не ја проверува својата работа', 'не е обезбедена'] },
      { k: 'date', n: 'Датум на проверка', t: 'date' }, { k: 'findings', n: 'Наоди (секој наод → неусогласеност)', t: 'area' }, { k: 'conclusion', n: 'Заклучок', t: 'area' },
    ],
  },
  {
    k: 'training', n: 'Обуки и компетентност', one: 'Обука', clause: 'ISO 9001 §7.2 · ISO 27001 §7.2–7.3', ic: '🎓', prefix: 'ОБ', g: 'qms',
    hint: 'Обуки на вработените (законски измени, програмата, безбедност на податоци) со доказ.',
    fields: [
      { k: 'who', n: 'Вработен / учесници' }, { k: 'topic', n: 'Тема' }, { k: 'provider', n: 'Предавач / организатор' }, { k: 'date', n: 'Датум', t: 'date' },
      { k: 'hours', n: 'Часови', t: 'num' }, { k: 'evidence', n: 'Доказ (сертификат, листа…) – прикачете го' },
      { k: 'required', n: 'Потребна компетентност за работното место', t: 'area' },
      { k: 'evaluation', n: 'Оценка на компетентноста', t: 'sel', o: ['', 'компетентен', 'потребна дополнителна обука', 'не е оценето'] },
      { k: 'evaluatedBy', n: 'Оценил' }, { k: 'evaluatedOn', n: 'Оценето на', t: 'date' }, { k: 'effectiveness', n: 'Ефективност на обуката (што се промени во работата)', t: 'area' },
    ],
  },
  {
    k: 'incident', n: 'Безбедносни инциденти', one: 'Инцидент', clause: 'ISO 27001 A.5.24–A.5.28 · ЗЗЛП чл. 37', ic: '🛡', prefix: 'ИН', g: 'qms',
    hint: 'Изгубен уред, погрешно испратен документ, неовластен пристап, пад на системот: што се случило, податоци, мерки, известување (АЗЛП во 72 часа).',
    fields: [
      { k: 'when', n: 'Кога се случило', t: 'date' }, { k: 'desc', n: 'Опис', t: 'area' }, { k: 'data', n: 'Засегнати податоци / клиенти' },
      { k: 'action', n: 'Преземени мерки', t: 'area' }, { k: 'notified', n: 'Известување (АЗЛП / клиенти)', t: 'sel', o: ['', 'не е потребно', 'известени во 72 ч.', 'известени подоцна', 'не се известени'] },
      { k: 'personal', n: 'Засегнати лични податоци (ЗЗЛП)', t: 'sel', o: ['', 'да', 'не'] },
      { k: 'found', n: 'Откриено (датум и час) – од тука 72 часа', t: 'dt' }, { k: 'notifiedOn', n: 'АЗЛП известена на', t: 'dt' },
    ],
  },
  {
    k: 'objective', n: 'Цели на квалитетот', one: 'Цел', clause: 'ISO 9001 §6.2', ic: '🏁', prefix: 'ЦЛ', g: 'qms',
    hint: 'Мерливи цели за годината (пр. 100% пријави во рок, поплаки < 3, одговор на клиент за 2 работни дена).',
    fields: [
      { k: 'std', n: 'Систем', t: 'sel', o: ['квалитет (ISO 9001)', 'безбедност на информациите (ISO 27001)', 'лични податоци (ISO 27701)', 'континуитет (ISO 22301)'] },
      { k: 'target', n: 'Цел (мерливо)' }, { k: 'measure', n: 'Како се мери' }, { k: 'plan', n: 'Што ќе се направи, со кои ресурси', t: 'area' },
      { k: 'evaluation', n: 'Како ќе се оценат резултатите' }, { k: 'value', n: 'Постигнато' },
    ],
  },
  {
    k: 'policy', n: 'Политики и документи', one: 'Документ', clause: 'ISO 9001 §5.2, §7.5 · ISO 27001 §5.2', ic: '📘', prefix: 'ДК', g: 'qms',
    hint: 'Политиките и постапките на канцеларијата под контрола на документите (ISO 9001 §7.5.2–7.5.3): ознака, верзија, изработил, одобрил и датум, следен преглед, дистрибуција; секоја нова верзија се запишува во историјата на измени. Документот е „во сила“ кога е одобрен.',
    fields: [
      { k: 'docNo', n: 'Ознака на документот' }, { k: 'version', n: 'Верзија' }, { k: 'author', n: 'Изработил' },
      { k: 'approvedBy', n: 'Одобрил' }, { k: 'approvedOn', n: 'Одобрено на', t: 'date' }, { k: 'reviewOn', n: 'Следен преглед', t: 'date' },
      { k: 'distribution', n: 'Дистрибуција (кој го добива)' }, { k: 'changeNote', n: 'Опис на измената (за оваа верзија)' }, { k: 'text', n: 'Текст', t: 'area' },
    ],
  },
  {
    k: 'auditplan', n: 'Програма за внатрешни проверки', one: 'Планирана проверка', clause: 'ISO 9001 §9.2.2 · ISO 27001 §9.2.2', ic: '🗓', prefix: 'ПГ', g: 'qms',
    hint: 'Годишна програма: кои процеси и клаузули, кога, кој проверува (независно – никој не ја проверува својата работа), по кои критериуми. Секоја извршена проверка се поврзува со својата ставка од програмата.',
    fields: [
      { k: 'std', n: 'Стандард', t: 'sel', o: ['интегрирано (сите)', 'ISO 9001', 'ISO 27001', 'ISO 27701 / ЗЗЛП', 'ISO 22301', 'ISO 10002'] },
      { k: 'area', n: 'Процеси / клаузули', t: 'area' }, { k: 'month', n: 'Планирано за', t: 'date' }, { k: 'auditor', n: 'Проверувач' },
      { k: 'independence', n: 'Независност', t: 'sel', o: ['', 'проверувачот не ја проверува својата работа', 'надворешен проверувач', 'не е обезбедена'] },
      { k: 'criteria', n: 'Критериуми' },
    ],
  },
  {
    k: 'review', n: 'Прегледи од раководството', one: 'Преглед', clause: 'ISO 9001 §9.3 · ISO 27001 §9.3 · ISO 22301 §9.3', ic: '🧭', prefix: 'ПР', g: 'qms',
    hint: 'Записник од одржаниот преглед (најмалку еднаш годишно): кога, кој присуствуваше, разгледаните влезни елементи (извештајот 🖨 се составува сам), одлуките и потребните ресурси – со потпис на управителот.',
    fields: [
      { k: 'date', n: 'Одржан на', t: 'date' }, { k: 'participants', n: 'Присутни' }, { k: 'inputs', n: 'Разгледано (влезни елементи)', t: 'area' },
      { k: 'decisions', n: 'Одлуки и мерки за подобрување', t: 'area' }, { k: 'resources', n: 'Потребни ресурси / промени во системот', t: 'area' }, { k: 'nextOn', n: 'Следен преглед', t: 'date' },
    ],
  },
  {
    k: 'supplier', n: 'Надворешни добавувачи', one: 'Добавувач', clause: 'ISO 9001 §8.4 · ISO 27001 A.5.19–A.5.22 · ЗЗЛП чл. 32', ic: '🤝', prefix: 'НД', g: 'qms',
    hint: 'Хостинг, интернет, AI, софтвер, сервис на опрема: критичност, дали обработуваат лични податоци (договор за обработка), сертификати, локација на податоците, оценка и следна оценка.',
    fields: [
      { k: 'service', n: 'Услуга' }, { k: 'criticality', n: 'Критичност', t: 'sel', o: ['висока', 'средна', 'ниска'] },
      { k: 'personal', n: 'Обработува лични податоци', t: 'sel', o: ['', 'да', 'не'] }, { k: 'dpa', n: 'Договор за обработка (DPA)', t: 'sel', o: ['', 'потпишан / прифатен', 'не е потпишан', 'не е потребен'] },
      { k: 'certs', n: 'Сертификати (ISO 27001, SOC 2…)' }, { k: 'location', n: 'Локација на податоците' },
      { k: 'evaluation', n: 'Оценка', t: 'sel', o: ['', 'одобрен', 'условно одобрен', 'неодобрен'] }, { k: 'evaluatedOn', n: 'Оценето на', t: 'date' }, { k: 'nextOn', n: 'Следна оценка', t: 'date' },
    ],
  },
  {
    k: 'processing', n: 'Обработки на лични податоци', one: 'Обработка', clause: 'ISO 27701 §7.2.8, §8.2.6 · ЗЗЛП чл. 30', ic: '🗂', prefix: 'ОЛ', g: 'pims',
    hint: 'Евиденција на активностите за обработка на канцеларијата: како контролор (вработени, клиенти, корисници) и како обработувач за клиентите – обработките по клиент се во Законска усогласеност, договорите за обработка во ЗЗЛП.',
    fields: [
      { k: 'role', n: 'Улога на канцеларијата', t: 'sel', o: ['контролор', 'обработувач (за клиентите)', 'заеднички контролор'] },
      { k: 'purpose', n: 'Цел на обработката', t: 'area' }, { k: 'basis', n: 'Правен основ (ЗЗЛП чл. 10)' }, { k: 'subjects', n: 'Категории субјекти' },
      { k: 'data', n: 'Категории лични податоци', t: 'area' }, { k: 'special', n: 'Посебни категории (чл. 13)', t: 'sel', o: ['', 'не', 'да'] },
      { k: 'recipients', n: 'Корисници / примачи' }, { k: 'transfer', n: 'Пренос надвор од ЕУ / ЕЕП' }, { k: 'retention', n: 'Рок на чување' },
      { k: 'security', n: 'Технички и организациски мерки', t: 'area' },
    ],
  },
  {
    k: 'dsr', n: 'Барања од субјекти', one: 'Барање', clause: 'ISO 27701 §7.3 · ЗЗЛП чл. 19–26', ic: '🙋', prefix: 'БС', g: 'pims',
    hint: 'Барање од лице за пристап, исправка, бришење, ограничување, преносливост или приговор: одговор најдоцна за 1 месец од приемот (рокот се пополнува сам). Податоците што законот бара да се чуваат не се бришат.',
    fields: [
      { k: 'person', n: 'Подносител (лице)' }, { k: 'type', n: 'Вид на барање', t: 'sel', o: ['', ...DSR_T] },
      { k: 'received', n: 'Примено на', t: 'date' }, { k: 'channel', n: 'Начин на прием', t: 'sel', o: ['е-пошта', 'писмо', 'лично', 'портал', 'преку клиентот (контролор)', 'друго'] },
      { k: 'identity', n: 'Идентитет', t: 'sel', o: ['', 'потврден', 'не е потврден'] },
      { k: 'answer', n: 'Одговор / што е направено', t: 'area' }, { k: 'answeredOn', n: 'Одговорено на', t: 'date' },
    ],
  },
  {
    k: 'dpia', n: 'Процени на влијание (DPIA)', one: 'Процена', clause: 'ISO 27701 §7.2.5 · ЗЗЛП чл. 39', ic: '⚖', prefix: 'ПВ', g: 'pims',
    hint: 'Пред нова обработка со висок ризик (нова програма или AI, посебни категории, пренос надвор од ЕУ, систематско следење): опис, ризици за лицата, мерки, преостанат ризик; висок преостанат ризик = претходна консултација со АЗЛП.',
    fields: [
      { k: 'processing', n: 'Обработка', t: 'ref', ref: 'processing' }, { k: 'need', n: 'Зошто е потребна процената', t: 'area' },
      { k: 'risks', n: 'Ризици за правата на лицата', t: 'area' }, { k: 'measures', n: 'Мерки за намалување', t: 'area' },
      { k: 'residual', n: 'Преостанат ризик', t: 'sel', o: ['', 'низок', 'среден', 'висок – претходна консултација со АЗЛП'] },
      { k: 'opinion', n: 'Мислење на офицерот за заштита', t: 'area' }, { k: 'decision', n: 'Одлука', t: 'area' },
    ],
  },
  {
    k: 'bcp', n: 'План за континуитет', one: 'Сценарио', clause: 'ISO 22301 §8.4 · ISO 27001 A.5.29–A.5.30', ic: '🧯', prefix: 'ПК', g: 'bcms',
    hint: 'Што правиме кога нешто ќе застане (серверот не работи, вработен отсуствува, рокот е утре, изгубени податоци): RTO – за колку часа мора пак да работиме, RPO – колку најмногу податоци смееме да изгубиме, одговорно лице, постапка и последен тест.',
    fields: [
      { k: 'impact', n: 'Влијание (што застанува)', t: 'area' },
      { k: 'rto', n: 'RTO – најдолг прекин (часови)', t: 'num' }, { k: 'rpo', n: 'RPO – најмногу изгубени податоци (часови)', t: 'num' },
      { k: 'deputy', n: 'Замена на одговорното лице' }, { k: 'steps', n: 'Постапка за враќање', t: 'area' }, { k: 'temp', n: 'Привремено решение', t: 'area' },
      { k: 'contacts', n: 'Контакти (сервер, интернет, УЈП…)' }, { k: 'lastTest', n: 'Последен тест / вежба', t: 'date' }, { k: 'every', n: 'Тест на секои (месеци)', t: 'num' },
    ],
  },
  {
    k: 'bctest', n: 'Тестови на враќање од резервна копија', one: 'Тест', clause: 'ISO 22301 §8.5 · ISO 27001 A.8.13', ic: '♻', prefix: 'ТВ', g: 'bcms',
    hint: 'Секој тест на враќање од резервна копија и секоја вежба на сценарио: колку траеше (споредено со RTO), колку стари беа податоците (споредено со RPO), резултат и наоди – најмалку двапати годишно.',
    fields: [
      { k: 'plan', n: 'Сценарио од планот', t: 'ref', ref: 'bcp' }, { k: 'type', n: 'Вид', t: 'sel', o: ['тест на враќање од резервна копија', 'вежба на сценарио', 'вистински прекин'] },
      { k: 'date', n: 'Датум на тестот', t: 'date' }, { k: 'backup', n: 'Резервна копија (од кога, каде)' },
      { k: 'took', n: 'Траење на враќањето (часови)', t: 'num' }, { k: 'lost', n: 'Изгубени податоци (часови)', t: 'num' },
      { k: 'result', n: 'Резултат', t: 'sel', o: ['', 'успешно', 'делумно', 'неуспешно'] }, { k: 'findings', n: 'Наоди и мерки', t: 'area' },
    ],
  },
  {
    k: 'staff', n: 'Вработени – безбедност на човечките ресурси', one: 'Вработен', clause: 'ISO 27001 A.6.1–A.6.6 · A.5.15–A.5.18 · ЗЗЛП чл. 36', ic: '👥', prefix: 'ВР', g: 'qms', hidden: true,
    hint: 'По вработен: договор за вработување со одредбите за доверливост и безбедност (потпишан, скен), прифатени политики со верзија, обуки, отворање и затворање на пристапот, враќање на средствата.',
    fields: [
      { k: 'employeeId', n: 'Вработен (id)' }, { k: 'userId', n: 'Корисник (id)' },
      { k: 'contractOn', n: 'Договорот потпишан на', t: 'date' }, { k: 'ackOn', n: 'Политиките прифатени на', t: 'date' }, { k: 'ackDocs', n: 'Прифатени политики (ознака и верзија)', t: 'area' },
      { k: 'onboardOn', n: 'Пристапот отворен на', t: 'date' }, { k: 'assetsOut', n: 'Задолжени средства (лаптоп, клучеви, токени…)', t: 'area' },
      { k: 'offboardOn', n: 'Престанок на работа', t: 'date' }, { k: 'assetsBack', n: 'Средствата вратени', t: 'sel', o: ['', 'да', 'делумно', 'не'] }, { k: 'accessOffOn', n: 'Пристапот затворен на', t: 'date' },
    ],
  },
];
export const isoKind = (k: string) => ISO_KINDS.find((x) => x.k === k);
export const isoKindsOf = (g: IsoGroup) => ISO_KINDS.filter((x) => x.g === g && !x.hidden);

/**
 * What a certifier expects before a record is closed (status „затворено“ / a document „во сила“); the message, or
 * null when it may be closed. Saving and „✓ Затвори“ both enforce it.
 */
export function isoCloseCheck(kind: IsoKind, d: Record<string, unknown>): string | null {
  const has = (k: string) => d[k] != null && String(d[k]).trim() !== '';
  const need = (L: [string, string][]) => { const m = L.filter(([k]) => !has(k)).map(([, n]) => n); return m.length ? `За затворање пополнете: ${m.join(', ')}.` : null; };
  switch (kind) {
    case 'complaint': return need([['action', 'одговор до клиентот']]);
    case 'nc': return need([['correction', 'корекција'], ['cause', 'причина'], ['corrective', 'корективна мерка'], ['verifiedOn', 'датум на проверка на ефективноста']]) ?? (d.effective === 'да' ? null : 'Записот се затвора дури кога корективната мерка е проверена и ефективна („Мерката е ефективна: да“).');
    case 'audit': return need([['date', 'датум'], ['findings', 'наоди'], ['conclusion', 'заклучок']]);
    case 'training': return need([['date', 'датум'], ['evaluation', 'оценка на компетентноста']]);
    case 'incident': return need([['action', 'преземени мерки']]) ?? (d.personal === 'да' && !d.notified ? 'Инцидент со лични податоци: внесете го известувањето до АЗЛП (или „не е потребно“).' : d.personal ? null : 'Означете дали се засегнати лични податоци.');
    case 'policy': return need([['docNo', 'ознака'], ['version', 'верзија'], ['approvedBy', 'одобрил'], ['approvedOn', 'датум на одобрување']]);
    case 'review': return need([['date', 'датум'], ['decisions', 'одлуки']]);
    case 'dsr': return need([['answeredOn', 'датум на одговор'], ['answer', 'одговор']]);
    case 'dpia': return need([['residual', 'преостанат ризик'], ['decision', 'одлука']]);
    case 'bctest': return need([['date', 'датум'], ['result', 'резултат']]);
    case 'risk': return need([['treatment', 'мерка']]);
    case 'supplier': return need([['evaluation', 'оценка'], ['evaluatedOn', 'датум на оценка']]);
    default: return null;
  }
}
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

export interface IsoRow { id: string; kind: IsoKind; no: number; year: number; title: string; status: IsoStatus; due: string | null; created: string; closed: string | null; data: Record<string, unknown>; ownerId?: string | null; firmId?: string | null; createdBy?: string | null }

/** Per register: total, open, overdue (open past the due date). */
export function isoOverview(R: readonly IsoRow[], today: string) {
  return ISO_KINDS.filter((d) => !d.hidden).map((d) => {
    const L = R.filter((r) => r.kind === d.k);
    const open = L.filter((r) => r.status !== 'done');
    return { k: d.k, total: L.length, open: open.length, late: open.filter((r) => r.due && r.due < today).length };
  });
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const DT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/;
/** „2026-10-20T14:30“ (or a date = 00:00) → ms, read as a naive local time; null when not a date. */
const dtMs = (v: unknown) => { const m = DT.exec(String(v ?? '')); return m ? Date.parse(`${m[0].length === 10 ? m[0] + 'T00:00' : m[0]}:00Z`) : null; };
const msDt = (n: number) => new Date(n).toISOString().slice(0, 16);
const addMonths1 = (d: string, n: number) => {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1)), last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(dd, last));
  return t.toISOString().slice(0, 10);
};

/** Hours to notify the Agency (АЗЛП) of a personal-data breach (ЗЗЛП чл. 37 / GDPR чл. 33). */
export const BREACH_HOURS = 72;
export type BreachState = 'na' | 'open' | 'overdue' | 'ok' | 'late';
/**
 * The 72-hour rule of a security incident: only when personal data are affected (`personal = да`) and the agency has
 * to be told (`notified ≠ не е потребно`); deadline = discovered (`found`, else the day it happened) + 72 h. `now` is
 * the local time „YYYY-MM-DDTHH:MM“.
 */
export function breach72(d: Record<string, unknown>, now: string): { state: BreachState; deadline: string | null; hoursLeft: number | null } {
  if (d.personal !== 'да' || d.notified === 'не е потребно') return { state: 'na', deadline: null, hoursLeft: null };
  const f = dtMs(d.found) ?? dtMs(d.when);
  if (f == null) return { state: 'open', deadline: null, hoursLeft: null };
  const dl = f + BREACH_HOURS * 36e5, n = dtMs(d.notifiedOn);
  if (n != null) return { state: n <= dl ? 'ok' : 'late', deadline: msDt(dl), hoursLeft: null };
  const left = Math.floor((dl - (dtMs(now) ?? 0)) / 36e5);
  return { state: left < 0 ? 'overdue' : 'open', deadline: msDt(dl), hoursLeft: left };
}

/** Data-subject request: answer within one month of receipt (ЗЗЛП чл. 19 ст. 3; +2 months with notice). */
export const dsrDue = (received: string) => addMonths1(received, 1);

/** The deadline a register sets by itself when none is typed: a request = received + 1 month, a breach = the 72 h day. */
export function isoAutoDue(kind: IsoKind, d: Record<string, unknown>, today: string): string | null {
  if (kind === 'dsr') return dsrDue(DT.test(String(d.received ?? '')) ? String(d.received) : today);
  if (kind === 'incident') { const b = breach72(d, `${today}T00:00`); return b.state === 'open' || b.state === 'overdue' ? b.deadline?.slice(0, 10) ?? null : null; }
  return null;
}

export type BcpState = 'ok' | 'due' | 'never' | 'failed';
export interface BcpStatus { r: IsoRow; rto: number | null; rpo: number | null; lastTest: string | null; next: string | null; test: IsoRow | null; rtoMet: boolean | null; rpoMet: boolean | null; state: BcpState }
/**
 * Each continuity scenario with its last test: the later of the plan's own „Последен тест“ and the tests recorded for
 * it; the next test after `every` months (6 by default); whether the last recorded test met RTO / RPO.
 */
export function bcpStatus(R: readonly IsoRow[], today: string): BcpStatus[] {
  const T = R.filter((r) => r.kind === 'bctest');
  const num = (v: unknown) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return R.filter((r) => r.kind === 'bcp').map((r) => {
    const tests = T.filter((t) => t.data.plan === r.id && DT.test(String(t.data.date ?? ''))).sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)));
    const test = tests[0] ?? null;
    const own = DT.test(String(r.data.lastTest ?? '')) ? String(r.data.lastTest).slice(0, 10) : null, td = test ? String(test.data.date).slice(0, 10) : null;
    const lastTest = own && td ? (own > td ? own : td) : own ?? td;
    const next = lastTest ? addMonths1(lastTest, Math.max(1, num(r.data.every) ?? 6)) : null;
    const rto = num(r.data.rto), rpo = num(r.data.rpo), took = test ? num(test.data.took) : null, lost = test ? num(test.data.lost) : null;
    const rtoMet = rto != null && took != null ? took <= rto : null, rpoMet = rpo != null && lost != null ? lost <= rpo : null;
    const state: BcpState = test && (test.data.result === 'неуспешно' || rtoMet === false || rpoMet === false) && td === lastTest ? 'failed'
      : !lastTest ? 'never' : next! < today ? 'due' : 'ok';
    return { r, rto, rpo, lastTest, next, test, rtoMet, rpoMet, state };
  });
}
export const BCP_STATE: Record<BcpState, string> = { ok: '✓ тестирано', due: '⚠ време за тест', never: '⚠ никогаш тестирано', failed: '✗ тестот не ги исполни RTO / RPO' };

/** The numbers of the management review (ISO 9001 §9.3.2) for one year. */
export function isoReview(R: readonly IsoRow[], year: number, today = `${year}-12-31`) {
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
    privacy: privacyReview(R, Y, today),
    continuity: { plans: bcpStatus(R, today), tests: of('bctest') },
  };
}

/** ISO 27701 / ЗЗЛП part of the review: processing register, requests answered in time, DPIAs, breaches and 72 h. */
function privacyReview(R: readonly IsoRow[], Y: readonly IsoRow[], today: string) {
  const D = Y.filter((r) => r.kind === 'dsr');
  const inTime = D.filter((r) => r.data.answeredOn && r.due && String(r.data.answeredOn) <= r.due).length;
  const late = D.filter((r) => r.due && (r.data.answeredOn ? String(r.data.answeredOn) > r.due : r.status !== 'done' && r.due < today)).length;
  const B = Y.filter((r) => r.kind === 'incident').map((r) => ({ r, b: breach72(r.data, `${today}T23:59`) })).filter((x) => x.b.state !== 'na');
  return {
    processing: R.filter((r) => r.kind === 'processing'),
    dsr: { n: D.length, answered: D.filter((r) => r.data.answeredOn || r.status === 'done').length, inTime, late, byType: countBy(D, 'type') },
    dpia: R.filter((r) => r.kind === 'dpia' && (Y.includes(r) || r.status !== 'done')),
    breaches: { n: B.length, ok: B.filter((x) => x.b.state === 'ok').length, late: B.filter((x) => x.b.state === 'late' || x.b.state === 'overdue').length, list: B },
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
export function isoStarterDocs(office: string): IsoDoc[] {
  const o = office || 'Канцеларијата';
  return [
    { docNo: 'ПЛ-01', title: 'Политика на квалитет', text: `${o} обезбедува сметководствени, даночни и советодавни услуги кои се точни, навремени и во согласност со законите на Република Северна Македонија.\n\nСе обврзуваме:\n1. Секоја пријава, исплата и извештај на клиентите да биде поднесен во законскиот рок.\n2. Книжењето да биде проверено пред затворање на периодот (физичка проверка на документите, усогласување на картиците).\n3. Секоја поплака на клиент да ја евидентираме и одговориме најдоцна за 2 работни дена.\n4. Вработените постојано да се обучуваат за законските измени.\n5. Да ги следиме целите на квалитетот и да го подобруваме системот (ISO 9001).\n\nПолитиката е соопштена на сите вработени и е достапна за клиентите.` },
    { docNo: 'ПЛ-02', title: 'Политика за безбедност на информациите', text: `${o} ги чува деловните и личните податоци на клиентите доверливи, интегрални и достапни (ISO 27001, Закон за заштита на личните податоци).\n\n1. Пристап до податоците имаат само овластени корисници, секој со своја лозинка и улога; пристапот се укинува веднаш по престанок на работа.\n2. Секоја промена во книгите се евидентира (дневник на промени) и не може да се избрише.\n3. Податоците се чуваат на сервер со дневна резервна копија; враќањето од копија се проверува најмалку двапати годишно.\n4. Документите се праќаат само на проверени адреси на клиентот; лозинки и пристапни податоци не се праќаат по е-пошта.\n5. Секој инцидент (изгубен уред, погрешно испратен документ, сомнителен пристап) веднаш се пријавува и евидентира; засегнатите и АЗЛП се известуваат во 72 часа кога е потребно.` },
    { docNo: 'ПЛ-03', title: 'Кодекс на однесување кон клиентите (ISO 10001)', text: `Обврски на ${o} кон секој клиент:\n1. Одговор на барање или прашање – најдоцна следниот работен ден.\n2. Известување за рок што се приближува (ДДВ, плати, годишна сметка) најмалку 5 дена однапред.\n3. Список на документи што недостасуваат – еднаш месечно, писмено.\n4. Јасна цена на услугите однапред; без скриени трошоци.\n5. Доверливост на сите податоци на клиентот.\n6. Секоја поплака се евидентира и се решава според Постапката за поплаки.` },
    { docNo: 'ПС-01', title: 'Постапка за поплаки (ISO 10002)', text: `1. Прием: поплаката се прима по секој канал (е-пошта, телефон, лично, портал) и веднаш се внесува во регистарот „Поплаки и приговори“.\n2. Потврда до клиентот во рок од 1 работен ден.\n3. Анализа на причината – одговорното лице.\n4. Одговор и решение – најдоцна за 2 работни дена (сложени случаи: 8 дена, со известување).\n5. Прашање до клиентот дали е задоволен; одговорот се запишува.\n6. Ако причината е во нашата работа – се отвора неусогласеност со корективна мерка.\n7. Поплаките се анализираат на Прегледот од раководството.` },
    { docNo: 'ПС-02', title: 'Постапка за неусогласености и корективни мерки', text: `1. Секоја грешка, пропуштен рок, наод од проверка или поплака од наша вина се внесува во „Неусогласености и корективни мерки“.\n2. Корекција – веднаш (исправка на книжење, дополнителна пријава…).\n3. Анализа на причината (зошто се случи).\n4. Корективна мерка за да не се повтори, со одговорно лице и рок.\n5. По рокот – проверка на ефективноста; дури тогаш записот се затвора.` },
    { docNo: 'ПС-03', title: 'Постапка за пристап, лозинки и резервни копии', text: `1. Корисник се отвора само по одобрение на управителот, со најмала потребна улога.\n2. Лозинките се лични, не се споделуваат; се менуваат при сомнеж.\n3. При заминување на вработен пристапот се затвора истиот ден.\n4. Резервна копија на базата се прави автоматски секој ден и пред секоја надградба на програмата.\n5. Двапати годишно се проверува враќање од копија; резултатот се запишува во внатрешна проверка.\n6. Дневникот на промени и грешките на системот се прегледуваат месечно.` },
    { docNo: 'ПЛ-04', title: 'Политика за заштита на личните податоци (ISO 27701 / ЗЗЛП)', text: `${o} ги обработува личните податоци законито, правично и транспарентно, во согласност со Законот за заштита на личните податоци (Сл. весник 42/2020) и ISO/IEC 27701.\n\n1. Улоги: за своите вработени, клиенти и корисници канцеларијата е контролор; за податоците што ги обработува за клиентите (плати, персонална евиденција, комитенти физички лица, АМЛ) е обработувач – само по писмен договор за обработка со секој клиент (чл. 32).\n2. Секоја обработка е запишана во „Обработки на лични податоци“: цел, правен основ, категории лица и податоци, примачи, пренос, рок на чување, мерки.\n3. Се обработуваат само податоците што се потребни за целта; по истекот на законскиот рок на чување се бришат или анонимизираат.\n4. Пред нова обработка со висок ризик (нова програма или AI, посебни категории, пренос надвор од ЕУ) се прави процена на влијание (DPIA).\n5. Барањата на лицата (пристап, исправка, бришење…) се одговараат најдоцна за 1 месец според Постапката за барања од субјекти.\n6. Повреда на безбедноста на личните податоци се пријавува на АЗЛП најдоцна 72 часа откако е откриена, според Постапката при повреда.\n7. Сите вработени потпишуваат изјава за доверливост и се обучуваат најмалку еднаш годишно.\n8. Подизведувачи (хостинг, AI читање на документи) се користат само со договор за обработка; серверите се во ЕУ.` },
    { docNo: 'ПС-04', title: 'Постапка при повреда на безбедноста на личните податоци (72 часа)', text: `1. Секој вработен што ќе забележи инцидент (изгубен лаптоп или телефон, документ испратен на погрешна адреса, неовластен пристап, сомнителна најава, вирус) веднаш го известува одговорното лице – истиот час.\n2. Одговорното лице го внесува во „Безбедносни инциденти“ со датум и час на откривање; од тој момент тече рокот од 72 часа.\n3. Веднаш: ограничување на штетата (промена на лозинки, блокирање пристап, барање до примачот да го избрише документот).\n4. Проценка: дали се засегнати лични податоци, кои лица и колку, каков е ризикот за нив.\n5. Ако постои ризик за правата на лицата – известување до Агенцијата за заштита на личните податоци најдоцна 72 часа од откривањето (чл. 37); ако се доцни, се наведува причината.\n6. Кога податоците се на клиент (канцеларијата е обработувач) – клиентот се известува без одлагање, за да може тој да ја извести Агенцијата.\n7. Ако ризикот за лицата е висок – се известуваат и самите лица (чл. 38).\n8. Се отвора неусогласеност со корективна мерка; инцидентот се анализира на Прегледот од раководството.` },
    { docNo: 'ПС-05', title: 'Постапка за барања од субјекти на лични податоци', text: `1. Барањето (пристап, исправка, бришење, ограничување, преносливост, приговор, повлекување согласност) може да стигне по секој канал – се внесува во „Барања од субјекти“ истиот ден; рокот за одговор (1 месец) се пополнува сам.\n2. Проверка на идентитетот на подносителот пред да се дадат податоци.\n3. Ако податоците се на клиент (канцеларијата е обработувач) – барањето веднаш се препраќа на клиентот, кој одлучува; канцеларијата му помага.\n4. Пристап и преносливост: копија од податоците, цел, правен основ, примачи и рок на чување.\n5. Бришење: податоците што законот бара да се чуваат (сметководствени документи 10 години, плати и персонална евиденција трајно / 50 години, АМЛ 10 години) не се бришат – обработката се ограничува на чување и тоа се објаснува во одговорот.\n6. Одговор најдоцна за 1 месец; при сложени барања рокот може да се продолжи за уште 2 месеци со известување во првиот месец.\n7. Одговорот и датумот се запишуваат; записот се затвора.` },
    { docNo: 'ПЛ-05', title: 'План за континуитет на работењето (ISO 22301)', text: `Цел: и при прекин (пад на серверот, губење податоци, отсуство на вработен, недостапен портал на УЈП, недостапна канцеларија) законските рокови на клиентите да се исполнат.\n\n1. Сценаријата, со RTO (најдолг дозволен прекин) и RPO (најмногу изгубени податоци), одговорно лице и замена, постапка и привремено решение, се во регистарот „План за континуитет“.\n2. Резервна копија на базата – автоматски секој ден и пред секоја надградба; шифрирана копија се чува и во канцеларијата (Македонија).\n3. Враќање од резервна копија се тестира најмалку двапати годишно; секој тест (траење, старост на податоците, резултат) се запишува во „Тестови на враќање од резервна копија“ и се споредува со RTO / RPO.\n4. За секој клиент постои замена (втор сметководител) со пристап до неговите податоци.\n5. Список на контакти (хостинг, интернет, УЈП, клиенти) е во секое сценарио и отпечатен во канцеларијата.\n6. По секој вистински прекин или неуспешен тест – неусогласеност со корективна мерка.\n7. Планот се преиспитува еднаш годишно на Прегледот од раководството.` },
    ...isoCertDocs(office),
  ];
}

/** A starting record of a register (the office reviews and edits it). */
export interface IsoStarter { title: string; status: IsoStatus; data: Record<string, unknown> }
const SEC = 'Пристап со лично корисничко име и лозинка по улоги; шифрирана врска (HTTPS); дневна шифрирана резервна копија; дневник на промени кој не може да се менува; сервер во ЕУ; изјави за доверливост';

/** The office's own processing activities (ЗЗЛП чл. 30) – „🗂 Креирај ги основните обработки“. */
export function isoStarterProcessing(): IsoStarter[] {
  const P = (title: string, d: Record<string, string>): IsoStarter => ({ title, status: 'progress', data: { security: SEC, transfer: 'нема (сервер во ЕУ)', special: 'не', ...d } });
  return [
    P('Вработени на канцеларијата', { role: 'контролор', purpose: 'Работен однос, пресметка и исплата на плата, придонеси, персонална евиденција', basis: 'Законска обврска (ЗРО, Закон за евиденции во областа на трудот, ЗПДД) и договор за вработување', subjects: 'Вработени, кандидати', data: 'Име и презиме, ЕМБГ, адреса, сметка, образование, плата, работно време, дознаки за боледување', special: 'да', recipients: 'УЈП, ФПИОСМ, ФЗОМ, АВРМ, банка', retention: 'Плати – трајно (50 години), персонална евиденција – трајно; кандидати – до изборот' }),
    P('Клиенти и нивни овластени лица', { role: 'контролор', purpose: 'Договор за сметководствени услуги, фактурирање, комуникација, наплата', basis: 'Договор (ЗЗЛП чл. 10) и законска обврска (ЗДДВ, Закон за сметководство)', subjects: 'Управители и овластени лица на клиентите, клиенти – физички лица', data: 'Име и презиме, функција, е-пошта, телефон, адреса', recipients: 'УЈП при контрола, банка', retention: '10 години по завршување на договорот' }),
    P('Обработка за клиентите (канцеларијата како обработувач)', { role: 'обработувач (за клиентите)', purpose: 'Сметководство, плати, персонална евиденција, комитенти физички лица, АМЛ – по налог на клиентот', basis: 'Договор за обработка со секој клиент (ЗЗЛП чл. 32); основот го има клиентот', subjects: 'Вработени и комитенти на клиентите', data: 'Според активностите по клиент (Законска усогласеност ▸ лични податоци)', special: 'да', recipients: 'Институции по налог на клиентот; подизведувачи: хостинг (ЕУ), AI читање на скенирани документи', transfer: 'AI читање (САД) – со стандардни договорни клаузули, само кога се користи скенирање', retention: 'Според законските рокови на клиентот; по раскин – враќање или бришење' }),
    P('Корисници на програмата и портал за клиенти', { role: 'контролор', purpose: 'Пристап до програмата, безбедност, доказ за промените', basis: 'Легитимен интерес и законска обврска (ЗЗЛП чл. 36 – мерки за безбедност)', subjects: 'Вработени, овластени лица на клиентите', data: 'Корисничко име, име, улога, дневник на најави и промени, IP адреса', recipients: '—', retention: 'Дневник на промени – 10 години' }),
    P('Анализа на клиент (АМЛ)', { role: 'контролор', purpose: 'Мерки за анализа на клиентот и вистинскиот сопственик', basis: 'Законска обврска (Закон за спречување перење пари и финансирање тероризам)', subjects: 'Управители, сопственици, вистински сопственици на клиентите', data: 'Име, ЕМБГ, лична карта, државјанство, носител на јавна функција', recipients: 'УФР – само по закон', retention: '10 години по завршување на односот' }),
  ];
}

/** The usual continuity scenarios of an accounting office (ISO 22301) – „🧯 Креирај ги основните сценарија“. */
export function isoStarterBcp(): IsoStarter[] {
  const S = (title: string, rto: number, rpo: number, d: Record<string, string>): IsoStarter => ({ title, status: 'progress', data: { rto, rpo, every: 6, ...d } });
  return [
    S('Серверот / програмата не работи', 4, 24, { impact: 'Нема книжење, пријави, плати ни портал за клиентите.', steps: '1. Проверка: статус на хостингот, интернет во канцеларијата, порака за грешка.\n2. Ако серверот не се крева за 1 час – нов сервер и враќање од последната дневна копија.\n3. Проверка на податоците по враќањето (последни книжења, фактури, плати).\n4. Известување до вработените, по потреба и до клиентите.', temp: 'Итни пријави директно на е-Даноци / порталите; документите се собираат и книжат по враќањето; локалната копија во канцеларијата за увид.', contacts: 'Хостинг (Hetzner Console), одржувач на програмата, интернет провајдер' }),
    S('Губење или оштетување на податоци (грешка, вирус, бришење)', 8, 24, { impact: 'Погрешни или изгубени книжења, документи, плати.', steps: '1. Веднаш се запира работата на засегнатата фирма / модул.\n2. Од дневникот на промени се утврдува што и кога е сменето.\n3. Враќање од последната исправна резервна копија (на посебна база за проверка), потоа префрлање на исправните податоци.\n4. Повторно внесување на работата од моментот на копијата до прекинот.\n5. Ако има лични податоци – инцидент и правилото за 72 часа.', temp: 'Работа на другите фирми продолжува; засегнатата се означува „во проверка“.', contacts: 'Одржувач на програмата, одговорно лице за безбедност' }),
    S('Отсуство на вработен (болест, напуштање)', 24, 0, { impact: 'Клиентите на вработениот без сметководител; рокови во опасност.', steps: '1. Замената (втор сметководител) ги презема клиентите истиот ден.\n2. Преглед во програмата: рокови, нерешени задачи, отворени пријави по клиент.\n3. Пристапите на вработениот што заминува се затвораат истиот ден.\n4. Клиентите се известуваат за новото контакт лице.', temp: 'Приоритет по рокови (ДДВ, плати, годишна сметка) – останатото по враќањето.', deputy: 'Втор сметководител по клиент (запишан кај клиентот)' }),
    S('Рокот е утре, а нешто не работи (портал на УЈП, струја, интернет)', 2, 0, { impact: 'Задоцнета пријава – казна за клиентот.', steps: '1. Доказ за недостапноста (слика од екранот со датум и час, известување на УЈП).\n2. Поднесување од друга локација / мобилен интернет.\n3. Ако порталот е недостапен – пријава веднаш по враќањето и допис до УЈП со доказот.\n4. Пријавите се подготвуваат најдоцна 2 работни дена пред рокот (не на последниот ден).', temp: 'Мобилен интернет, лаптоп со полна батерија, работа од дома.', contacts: 'УЈП – контакт центар, интернет провајдер' }),
    S('Канцеларијата е недостапна (пожар, поплава, нема струја)', 24, 24, { impact: 'Нема пристап до хартиените документи и опремата.', steps: '1. Работа од дома – програмата е на сервер во ЕУ, достапна преку интернет.\n2. Хартиените документи на клиентите се скенираат при прием, па се достапни во програмата.\n3. Привремен простор / опрема по потреба.', temp: 'Работа од дома со лични лаптопи (со лозинка и шифриран диск).' }),
    S('Неовластен пристап / украдена лозинка', 1, 24, { impact: 'Тајност на податоците на клиентите, можни измени.', steps: '1. Веднаш: промена на лозинката, затворање на сите сесии, проверка на улогата.\n2. Дневник на промени и најави – што е видено / сменето.\n3. Враќање на сменетото од дневникот или резервната копија.\n4. Инцидент; ако има лични податоци – АЗЛП во 72 часа.', temp: 'Привремено затворање на засегнатиот корисник.' }),
  ];
}

/** The usual external providers of the office (ISO 9001 §8.4, ISO 27001 A.5.19–5.22) – to be evaluated. */
export function isoStarterSuppliers(): IsoStarter[] {
  const S = (title: string, d: Record<string, string>): IsoStarter => ({ title, status: 'open', data: d });
  return [
    S('Hetzner Online GmbH – хостинг', { service: 'Сервер и база на програмата, резервни копии', criticality: 'висока', personal: 'да', dpa: 'потпишан / прифатен', certs: 'ISO/IEC 27001', location: 'Германија / Финска (ЕУ)' }),
    S('Anthropic PBC – AI читање на документи', { service: 'Автоматско читање на скенирани документи', criticality: 'средна', personal: 'да', dpa: 'потпишан / прифатен', certs: 'SOC 2 Type II, ISO/IEC 27001', location: 'САД – стандардни договорни клаузули' }),
    S('Интернет провајдер на канцеларијата', { service: 'Интернет врска', criticality: 'висока', personal: 'не', dpa: 'не е потребен', location: 'Македонија' }),
    S('Е-пошта (провајдер)', { service: 'Е-пошта на канцеларијата', criticality: 'висока', personal: 'да', dpa: 'не е потпишан', location: '' }),
    S('Сервис на компјутерска опрема', { service: 'Одржување на лаптопи и печатачи', criticality: 'ниска', personal: 'да', dpa: 'не е потпишан', location: 'Македонија' }),
  ];
}

/** A year's internal audit programme covering every standard (ISO 9001 / 27001 §9.2.2). */
export function isoStarterAuditPlan(year: number): IsoStarter[] {
  const P = (q: number, std: string, area: string): IsoStarter => ({ title: `${q}/${year} – ${std}`, status: 'open', data: { std, area, month: `${year}-${String(q * 3).padStart(2, '0')}-15`, criteria: 'стандардот, документите на системот (ПЛ / ПС / СУ), законите', independence: 'проверувачот не ја проверува својата работа' } });
  return [
    P(1, 'ISO 9001', '§4 контекст и опсег, §5 политика и улоги, §6 ризици и цели, §7 ресурси, компетентност и документи, §8 услуги кон клиентите, ISO 10002 поплаки'),
    P(2, 'ISO 27001', '§4–§10 и контролите од Анекс А според Изјавата за применливост: пристап (A.5.15–5.18, A.8.2–8.5), резервни копии (A.8.13), дневник (A.8.15), добавувачи (A.5.19–5.22), човечки ресурси (A.6)'),
    P(3, 'ISO 27701 / ЗЗЛП', 'евиденција на обработки, договори за обработка со клиентите, барања од субјекти, DPIA, повреди и 72 часа, рокови на чување, подизведувачи'),
    P(4, 'ISO 22301', 'план за континуитет, анализа на влијанието (RTO / RPO), тестови на враќање од резервна копија, комуникација при прекин; §9.1 мерење и цели пред прегледот од раководството'),
  ];
}

/** The registers that have starting records: documents, processing activities, continuity scenarios, suppliers, the audit programme. */
export function isoStarters(kind: IsoKind, office: string, year = new Date().getFullYear()): IsoStarter[] {
  if (kind === 'policy') return isoStarterDocs(office).map((d) => ({ title: d.title, status: 'progress', data: { docNo: d.docNo, version: '1.0', author: office || '', text: d.text } }));
  if (kind === 'processing') return isoStarterProcessing();
  if (kind === 'bcp') return isoStarterBcp();
  if (kind === 'supplier') return isoStarterSuppliers();
  if (kind === 'auditplan') return isoStarterAuditPlan(year);
  return [];
}
