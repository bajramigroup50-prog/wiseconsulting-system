/**
 * Personal data protection (Закон за заштита на личните податоци — ЗЗЛП, Сл. весник 42/2020, усогласен со GDPR):
 * the per-firm register of processing activities (евиденција на активности за обработка), the default activities an
 * accounting office performs for a client as processor, and the verdict on a data-subject request that respects
 * the legal retention periods (an erasure request never removes records the law obliges us to keep).
 */
import { RETENTION, retentionUntil, type RetentionKind } from './retention';

export interface ProcessingActivity {
  /** Stable key of a default activity (custom ones get a generated key). */
  key: string;
  name: string;
  purpose: string;
  /** Legal basis (ЗЗЛП чл. 10). */
  basis: string;
  subjects: string;
  data: string;
  recipients: string;
  retention: RetentionKind;
  security: string;
  /** Special categories (health — sick leave) need the extra basis of ЗЗЛП чл. 13. */
  special?: boolean;
}

const SEC = 'Пристап со корисничко име и лозинка по улоги; шифрирана врска (HTTPS); дневна шифрирана резервна копија; дневник на активности кој не може да се менува; сервер во ЕУ';
const LEGAL = 'ЗЗЛП чл. 10 – исполнување на законска обврска на контролорот (клиентот)';

/** What the office processes for a client (the client is the controller, the office the processor — ЗЗЛП чл. 32). */
export const DEFAULT_ACTIVITIES: readonly ProcessingActivity[] = [
  { key: 'payroll', name: 'Пресметка на плати и придонеси', purpose: 'Пресметка и исплата на плата, МПИН, персонален данок, придонеси', basis: `${LEGAL} (Закон за работните односи, Закон за придонеси, ЗПДД)`, subjects: 'Вработени', data: 'Име и презиме, ЕМБГ, адреса, трансакциска сметка, плата, работни часови, стаж', recipients: 'УЈП (МПИН), ФПИОСМ, ФЗОМ, АВРМ, банка', retention: 'payroll', security: SEC },
  { key: 'sick', name: 'Боледувања и надоместоци', purpose: 'Пресметка на надоместок за боледување и рефундација', basis: 'ЗЗЛП – посебни категории (здравје): обврски од работен однос и социјална заштита (чл. 13, за потврда); чл. 85 – обработка во работен однос', subjects: 'Вработени', data: 'Дознаки за боледување (податоци за здравје – посебна категорија)', recipients: 'ФЗОМ', retention: 'payroll', security: SEC, special: true },
  { key: 'hr', name: 'Персонална евиденција и договори за вработување', purpose: 'Евиденции во областа на трудот, М1/М2 пријави', basis: `${LEGAL} (Закон за евиденции во областа на трудот)`, subjects: 'Вработени, кандидати', data: 'Лични податоци од договорот, образование, работно место', recipients: 'АВРМ, ДИТ при контрола', retention: 'personnel', security: SEC },
  { key: 'partners', name: 'Комитенти – физички лица', purpose: 'Фактурирање, книжење на побарувања и обврски', basis: `${LEGAL} (Закон за ДДВ, Закон за трговските друштва) и ЗЗЛП чл. 10 – договор`, subjects: 'Купувачи / добавувачи физички лица', data: 'Име и презиме, адреса, ЕМБГ (кога е потребен), сметка', recipients: 'УЈП при контрола', retention: 'invoice', security: SEC },
  { key: 'aml', name: 'Анализа на клиент (АМЛ)', purpose: 'Мерки за анализа на клиентот', basis: `${LEGAL} (Закон за спречување перење пари и финансирање тероризам)`, subjects: 'Управители, сопственици, вистински сопственици', data: 'Име, ЕМБГ, лична карта, државјанство, носител на јавна функција', recipients: 'УФР (само по закон)', retention: 'aml', security: SEC },
  { key: 'portal', name: 'Портал за клиенти и комуникација', purpose: 'Размена на документи и пораки со клиентот', basis: 'ЗЗЛП чл. 10 – договор за сметководствени услуги', subjects: 'Овластени лица на клиентот', data: 'Име, е-пошта, телефон, дневник на најави', recipients: '—', retention: 'contract', security: SEC },
];

export const DSR_TYPES = {
  access: 'Пристап до податоците',
  rect: 'Исправка',
  erase: 'Бришење („право да се биде заборавен“)',
  restrict: 'Ограничување на обработката',
  port: 'Преносливост',
  object: 'Приговор на обработката',
} as const;
export type DsrType = keyof typeof DSR_TYPES;
export const isDsrType = (x: unknown): x is DsrType => typeof x === 'string' && x in DSR_TYPES;

export interface DsrVerdict {
  outcome: 'grant' | 'partial' | 'refuse';
  text: string;
  /** Records that must be kept, with the date until which. */
  keep: { kind: RetentionKind; label: string; until: string | null }[];
}

/**
 * Verdict on a data-subject request. Erasure / restriction / objection cannot remove data the controller must
 * keep by law (ЗЗЛП — the right to erasure does not apply where processing is necessary for compliance with a legal
 * obligation): those categories are kept until their retention date and the reply cites that; everything else is
 * granted. Access, rectification and portability are always granted (rectification of a booked document is done by
 * a correcting document, never by editing the original).
 */
export function dsrVerdict(type: DsrType, categories: readonly { kind: RetentionKind; lastDate: string }[], today: string): DsrVerdict {
  const keep = categories
    .map((c) => ({ kind: c.kind, label: RETENTION[c.kind].label, until: retentionUntil(c.lastDate, c.kind) }))
    .filter((c) => c.until == null || today <= c.until);
  if (type === 'access' || type === 'port') return { outcome: 'grant', keep: [], text: 'Барањето се одобрува: на субјектот му се доставува копија од податоците што се обработуваат (во структуриран, машински читлив формат), целта, правниот основ, примателите и рокот на чување.' };
  if (type === 'rect') return { outcome: 'grant', keep: [], text: 'Барањето се одобрува: матичните податоци се исправаат; веќе издадените и прокнижени документи не се менуваат туку се коригираат со нов документ (заради законската обврска за чување на сметководствените документи).' };
  if (!keep.length) return { outcome: 'grant', keep, text: 'Барањето се одобрува: нема законска обврска за понатамошно чување – податоците се бришат / анонимизираат и тоа се евидентира.' };
  const all = keep.length === categories.length;
  return {
    outcome: all ? 'refuse' : 'partial', keep,
    text: `${all ? 'Барањето не може да се исполни' : 'Барањето се исполнува делумно'}: следните податоци мора да се чуваат заради законска обврска на контролорот – ${keep.map((k) => `${k.label} (${k.until ? `до ${k.until.split('-').reverse().join('.')}` : 'трајно'})`).join('; ')}. По истекот на рокот податоците ќе бидат избришани. Обработката до тогаш е ограничена само на чување и законски увид.`,
  };
}

/** Deadline to answer a data-subject request: one month from receipt (extendable by two more months with notice). */
export const DSR_ANSWER_MONTHS = 1;
/** Deadline to notify the Agency of a personal-data breach: 72 hours from becoming aware of it. */
export const BREACH_NOTIFY_HOURS = 72;
