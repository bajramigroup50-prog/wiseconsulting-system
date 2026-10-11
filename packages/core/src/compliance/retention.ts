/**
 * Retention periods (рокови на чување) of accounting records and the deletion verdict that follows from them.
 *
 * A record younger than its retention period is never physically deleted: an issued document is cancelled
 * (сторно — it keeps its number, the journal is reversed, the cancellation is audited), books are only corrected by
 * new entries. The periods are counted from the END of the business year the record belongs to.
 * Sources and the points still waiting for the office's confirmation are in docs/legal/COMPLIANCE.md (§ Чување).
 */

export type RetentionKind =
  | 'books' | 'annual' | 'payroll' | 'invoice' | 'purchase' | 'bank' | 'cash' | 'vat' | 'tax_return'
  | 'contract' | 'fiscal' | 'personnel' | 'aml' | 'audit' | 'gdpr';

export interface RetentionRule {
  kind: RetentionKind;
  label: string;
  /** Years after the end of the business year; `null` = permanently (трајно). */
  years: number | null;
  law: string;
  /** True = the period is the program's conservative reading; the office must confirm it (see COMPLIANCE.md). */
  confirm?: boolean;
}

const ZDP48 = 'Закон за даночна постапка, чл. 48 (10 години од крајот на годината на последниот запис / документ)';
export const RETENTION: Readonly<Record<RetentionKind, RetentionRule>> = {
  books: { kind: 'books', label: 'Деловни книги (дневник, главна книга, помошни книги), пописи', years: 10, law: ZDP48 },
  annual: { kind: 'annual', label: 'Годишна сметка и финансиски извештаи', years: null, law: `${ZDP48}; Листа на архивски материјал (трајно)`, confirm: true },
  payroll: { kind: 'payroll', label: 'Платни списоци / рекапитулации на плата', years: null, law: 'Закон за архивски материјал и архивска дејност (Сл. весник 135/2025) и листата на документарен материјал (трајно – доказ за стаж и пензија)', confirm: true },
  invoice: { kind: 'invoice', label: 'Излезни фактури и одобренија', years: 10, law: `${ZDP48}; ЗДДВ чл. 56 (најмалку 5 години, е-фактура во изворна форма)` },
  purchase: { kind: 'purchase', label: 'Влезни фактури и увозни документи', years: 10, law: `${ZDP48}; ЗДДВ чл. 56` },
  bank: { kind: 'bank', label: 'Изводи и налози за плаќање', years: 10, law: `${ZDP48} (сметководствени документи)` },
  cash: { kind: 'cash', label: 'Благајнички документи и дневник', years: 10, law: `${ZDP48} – документите за книжење 10 години (дневните евиденции за готовина најмалку 5)` },
  vat: { kind: 'vat', label: 'ДДВ пријави и книги за влезни / излезни фактури', years: 10, law: `${ZDP48}; ЗДДВ чл. 56` },
  tax_return: { kind: 'tax_return', label: 'Даночни пријави (ДБ, МПИН, ПДД) и доказите за нив', years: 10, law: `${ZDP48}; чл. 110 (апсолутна застареност 10 години)` },
  contract: { kind: 'contract', label: 'Договори и деловна кореспонденција', years: 10, law: `${ZDP48} (деловни писма и кореспонденција)` },
  fiscal: { kind: 'fiscal', label: 'Фискални извештаи и контролни ленти', years: 5, law: 'Закон за регистрирање на готовински плаќања, чл. 8 (контролна лента 5 години); книгата на дневни извештаи – 10 (ЗДП чл. 48)' },
  personnel: { kind: 'personnel', label: 'Персонални досиеја, договори за вработување, М1/М2', years: null, law: 'Закон за евиденции во областа на трудот; листа на документарен материјал (трајно)', confirm: true },
  aml: { kind: 'aml', label: 'Документи за анализа на клиент (АМЛ)', years: 10, law: 'Закон за спречување перење пари и финансирање тероризам (10 години по завршување на деловниот однос)', confirm: true },
  audit: { kind: 'audit', label: 'Дневник на активности (кој, кога, што)', years: null, law: 'Доказ за книжењата (ЗДП чл. 48) и безбедност на обработката (ЗЗЛП чл. 36) – програмата го чува трајно и не дозволува измена' },
  gdpr: { kind: 'gdpr', label: 'Евиденции за заштита на личните податоци', years: 5, law: 'ЗЗЛП чл. 28, 34 (докажување на усогласеност) – рокот го определува контролорот', confirm: true },
};

/** Last day of the retention period: 31.12. of (year of the record + years); `null` = permanent. */
export function retentionUntil(recordDate: string, kind: RetentionKind): string | null {
  const r = RETENTION[kind];
  if (r.years == null) return null;
  const y = Number(recordDate.slice(0, 4));
  if (!Number.isFinite(y) || y < 1900) throw new Error('Неважечки датум на документот.');
  return `${y + r.years}-12-31`;
}

/** Is the record still under retention on `today`? Permanent records always are. */
export function underRetention(recordDate: string, kind: RetentionKind, today: string): boolean {
  const u = retentionUntil(recordDate, kind);
  return u == null || today <= u;
}

export type DeletionVerdict =
  /** Not issued / no legal effect yet (draft, proforma, client entry awaiting approval) or the last number — may be removed. */
  | { action: 'delete'; reason: string }
  /** Issued and under retention — becomes a cancellation (сторно) that keeps the number. */
  | { action: 'cancel'; reason: string }
  /** Must stay as it is (locked period, permanent record …). */
  | { action: 'block'; reason: string };

export interface DeletionInput {
  kind: RetentionKind;
  date: string;
  /** Document status in the program. */
  status: 'draft' | 'pending' | 'posted' | string;
  /** Proforma / dispatch note (not a tax document). */
  nonTax?: boolean;
  /** No higher number of the same kind / series / year exists. */
  lastInSeries: boolean;
  /** Already cancelled. */
  cancelled?: boolean;
  today: string;
}

/**
 * What "delete" means for an outgoing document:
 * - draft / pending / proforma / dispatch → delete (nothing was issued or booked);
 * - an issued invoice that is the last of its series → delete (no gap, audited);
 * - an issued invoice inside the series → cancel (сторно): the number stays, journals are reversed;
 * - an already cancelled one that is not last → block.
 */
export function deletionVerdict(x: DeletionInput): DeletionVerdict {
  if (x.status === 'pending' || x.nonTax) return { action: 'delete', reason: 'Документот не е издаден како даночен документ.' };
  if (x.status === 'draft' && !x.cancelled) return { action: 'delete', reason: 'Нацрт – не е издаден.' };
  if (x.lastInSeries) return { action: 'delete', reason: 'Последен број во серијата – бришењето не остава прескокнат број.' };
  if (x.cancelled) return { action: 'block', reason: 'Сторнираната фактура мора да остане во евиденцијата (го чува редниот број).' };
  const until = retentionUntil(x.date, x.kind);
  return { action: 'cancel', reason: `Издадена фактура во средината на серијата – се сторнира (бројот останува), не се брише. Рок на чување: ${until ? until.split('-').reverse().join('.') : 'трајно'}.` };
}
