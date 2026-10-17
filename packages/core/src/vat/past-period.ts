/**
 * „⏸ Минат период – за проверка“ (the owner's rule, 17.10.2026): a document that arrives AUTOMATICALLY — a bulk save
 * („Зачувај ги сите спремни“ / „Зачувај ги сите што се во ред“), an import (Excel purchases / invoices), the inbox — is
 * never posted into a PAST VAT period on its own, because posting it changes the ДДВ-04 of a period that is already
 * prepared or filed. It is held apart for the owner's decision.
 *
 * A date is in a past period when its VAT period (monthly / quarterly by the firm's status):
 * - (a) is closed / filed in WISE (`vat_periods.status = 'closed'`, „поднесена“), or
 * - (b) is earlier than the VAT period that contains today — when the firm setting
 *   „Задржи ги сите документи од претходни ДДВ периоди“ is on (`settings.pastVatHold`, ON by default), or
 * - the books are locked up to that date (`firms.lock_date`; posting is refused anyway).
 *
 * The decision (`pastDecisionOptions`): „✓ Прокнижи во својот период“ (keeps the date; ДДВ-04 of that period must be
 * corrected), for an INCOMING invoice only „Прокнижи со датум на прием во тековниот период“ (the receipt date sets the
 * VAT period of input VAT — never for an outgoing invoice, which belongs to its issue date), or „✕ Отфрли“.
 * Pure: the database side (closed periods, the save, the audit) is `@wise/db` `vat-past.ts`.
 */
import { can, type Principal } from '../rbac';
import { periodOf, perRange, type VatPeriodKind } from '../vat';

/**
 * Who decides a held document (confirm / reject / the setting): the owner, or a user with the `fix` or `settings`
 * right on the firm. Book-only colleagues and the others see the held items but cannot decide them.
 */
export const canDecidePast = (u: Principal | null | undefined, firmId: string, owner = false): boolean =>
  !!u && (can(u, 'fix', firmId) || can(u, 'settings', firmId) || (owner && can(u, 'write', firmId)));

export interface PastClosedPeriod { period: string; dateFrom: string; dateTo: string; submittedAt?: string | null }

export interface PastPeriodCtx {
  kind: VatPeriodKind;
  /** ISO date of today (Skopje). */
  today: string;
  /** The firm's closed (filed) VAT periods with their stored date ranges. */
  closed: readonly PastClosedPeriod[];
  /** Books locked up to and including this date. */
  lockDate?: string | null;
  /** (b) „Задржи ги сите документи од претходни ДДВ периоди“. */
  holdPrevious: boolean;
}

export type PastReason = 'closed' | 'previous' | 'locked';

/** Why a document is held: stored on the held draft (`AiDraft.past`) and shown in the review. */
export interface PastPeriodHit {
  /** `YYYY-MM` / `YYYY-Тq`. */
  period: string;
  from: string; to: string;
  reason: PastReason;
  /** The period's ДДВ-04 is closed / filed in WISE. */
  closed: boolean;
  submittedAt?: string | null;
  /** „ДДВ Q2/2026 (април–јуни), затворен“. */
  text: string;
}

const MONTHS = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dmy = (d: string) => d.split('-').reverse().join('.');

/** „ДДВ Q2/2026 (април–јуни)“ / „ДДВ 06/2026 (јуни)“. */
export function vatPeriodName(period: string): string {
  const [from, to] = perRange(period);
  const y = from.slice(0, 4);
  const m1 = Number(from.slice(5, 7)), m2 = Number(to.slice(5, 7));
  if (period.includes('-Т')) return `ДДВ Q${period.split('-Т')[1]}/${y} (${MONTHS[m1 - 1]}–${MONTHS[m2 - 1]})`;
  return `ДДВ ${String(m1).padStart(2, '0')}/${y} (${MONTHS[m1 - 1]})`;
}

/** The firm setting (b): ON unless switched off explicitly. */
export const pastHoldPrevious = (settings: Record<string, unknown> | null | undefined): boolean => (settings ?? {}).pastVatHold !== false;

/** The past VAT period of `date`, or null when the document may be posted automatically. */
export function pastPeriodOf(date: string | null | undefined, ctx: PastPeriodCtx): PastPeriodHit | null {
  if (!date || !ISO.test(date)) return null;
  const c = ctx.closed.find((p) => p.dateFrom <= date && date <= p.dateTo);
  const period = c?.period ?? periodOf(date, ctx.kind);
  const [from, to] = c ? [c.dateFrom, c.dateTo] : perRange(period);
  const name = vatPeriodName(period);
  const base = { period, from, to, closed: !!c, submittedAt: c?.submittedAt ?? null };
  if (ctx.lockDate && date <= ctx.lockDate) return { ...base, reason: 'locked', text: `${name}, книгите се заклучени до ${dmy(ctx.lockDate)}` };
  if (c) return { ...base, reason: 'closed', text: `${name}, затворен${c.submittedAt ? ` (поднесен ${dmy(c.submittedAt.slice(0, 10))})` : ''}` };
  if (ctx.holdPrevious && to < perRange(periodOf(ctx.today, ctx.kind))[0]) return { ...base, reason: 'previous', text: `${name}, претходен период` };
  return null;
}

/** The status line of a held draft. */
export const pastHoldMsg = (h: Pick<PastPeriodHit, 'text'>): string => `⏸ минат период – за проверка: ${h.text}`;

/**
 * The VAT date of a read draft: an outgoing invoice → its issue date; an incoming one → the receipt date, or the
 * invoice date when the read moved it to today because its period was closed (`shifted`).
 */
export function draftVatDate(kind: 'purchase' | 'sale', d: { date?: string; docDate?: string; shifted?: boolean }): string {
  if (kind === 'purchase' && d.shifted && d.docDate) return d.docDate;
  return String(d.date ?? '');
}

export interface PastDecisionOptions {
  /** „✓ Прокнижи во својот период“ — not while the period is closed / locked (reopen the period first). */
  own: boolean;
  ownWhyNot?: string;
  /** „Прокнижи со датум на прием во тековниот период“ — incoming invoices only. */
  receipt: boolean;
}

export function pastDecisionOptions(kind: 'purchase' | 'sale', h: PastPeriodHit): PastDecisionOptions {
  const ownWhyNot = h.reason === 'locked' ? 'книгите се заклучени за тој датум – прво отклучете ги'
    : h.closed ? 'периодот е затворен – прво отворете го во ДДВ-04' : undefined;
  return { own: !ownWhyNot, ...(ownWhyNot ? { ownWhyNot } : {}), receipt: kind === 'purchase' };
}

/** Why an outgoing invoice is never moved to another period (the note in the review). */
export const OUTGOING_DATE_NOTE = 'Излезната фактура секогаш припаѓа на периодот на датумот на издавање – не може да се прокнижи со друг датум. Датум на прием важи само за влезни фактури (претходен ДДВ).';

/** The receipt date for „со датум на прием“: within the current VAT period, not before the invoice, not after today. */
export function receiptDateOk(date: string, ctx: Pick<PastPeriodCtx, 'kind' | 'today'>, docDate?: string | null): string | null {
  if (!ISO.test(date)) return 'Внесете датум на прием.';
  if (date > ctx.today) return 'Датумот на прием не може да биде во иднина.';
  if (periodOf(date, ctx.kind) !== periodOf(ctx.today, ctx.kind)) return `Датумот на прием мора да е во тековниот ДДВ период (${vatPeriodName(periodOf(ctx.today, ctx.kind))}).`;
  if (docDate && ISO.test(docDate) && date < docDate) return 'Датумот на прием не може да биде пред датумот на фактурата.';
  return null;
}
