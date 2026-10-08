/**
 * VAT-period lock for the posting service (legacy `ddvClosed` 4501 + `vatCol` 3312, used by `save` / `delBlock`).
 *
 * Once a VAT period is closed (filed and posted, see `closeVatPeriod`), no journal dated inside its
 * stored range may be posted, replaced or removed if it would change that period's VAT:
 * - journals of VAT documents (`VAT_SOURCE_TYPES`: invoices, purchases, Z reports, cash vouchers,
 *   supplier credits — legacy `vatCol`), even without a VAT line (a 0% sale changes field 08);
 * - any other journal (manual nalog, bank…) that touches one of the firm's VAT kontos.
 * The VAT-close journal itself (`source_type = 'vatPeriod'`) is exempt. Reopen the period to change it.
 *
 * FIX (LEGACY-MAP 5.4 item 8): uses the stored `[date_from, date_to]` of the closed period instead of
 * re-deriving the period from the firm's current month/quarter setting.
 */
import { and, eq, gte, lte } from 'drizzle-orm';
import { vatAccountSet } from '@wise/core';
import type { Tx } from './audit';
import { journalLines, vatPeriods, type Firm } from './schema/index';
import { PostingError } from './posting';
import { loadVatPostingContext } from './vat-context';
import { VAT_CLOSE_SOURCE } from './vat-source';

/**
 * Document source types whose journals feed ДДВ-04 (legacy `vatCol`).
 * TODO(merge): align with the `sourceType` names Phases 3/4/7 actually use when posting.
 */
export const VAT_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'invoice', 'purchase', 'sale', 'sales', 'fisk', 'zreport', 'blg', 'cashVoucher', 'supcr', 'supplierCredit',
  'cash_voucher', // Phase 4 cash vouchers (blgEntries, input VAT)
]);

const dmy = (d: string) => d.split('-').reverse().join('.');

/** The closed VAT period containing `date`, if any. */
export async function closedVatPeriodAt(tx: Tx, firmId: string, date: string) {
  const [p] = await tx.select({ period: vatPeriods.period, dateFrom: vatPeriods.dateFrom, dateTo: vatPeriods.dateTo }).from(vatPeriods)
    .where(and(eq(vatPeriods.firmId, firmId), eq(vatPeriods.status, 'closed'), lte(vatPeriods.dateFrom, date), gte(vatPeriods.dateTo, date)))
    .limit(1);
  return p ?? null;
}

/**
 * Throw `vat_closed` if a journal (new or existing) dated `date` would change a closed VAT period.
 * `accounts` are the journal's line accounts; pass `journalId` instead to read them from the database.
 */
export async function assertVatPeriodOpen(
  tx: Tx, firm: Pick<Firm, 'id' | 'vatRegistered' | 'settings'>,
  j: { date: string; sourceType?: string | null; accounts?: readonly string[]; journalId?: string },
): Promise<void> {
  if (j.sourceType === VAT_CLOSE_SOURCE) return;
  const p = await closedVatPeriodAt(tx, firm.id, j.date);
  if (!p) return;
  let hit = !!j.sourceType && VAT_SOURCE_TYPES.has(j.sourceType);
  if (!hit) {
    const accounts = j.accounts ?? (j.journalId
      ? (await tx.select({ a: journalLines.account }).from(journalLines).where(eq(journalLines.journalId, j.journalId))).map((r) => r.a)
      : []);
    const K = vatAccountSet(await loadVatPostingContext(tx, firm));
    hit = accounts.some((a) => K.has(String(a).trim()));
  }
  if (hit) {
    throw new PostingError('vat_closed',
      `ДДВ периодот ${p.period} (${dmy(p.dateFrom)} – ${dmy(p.dateTo)}) е затворен – документот со датум ${dmy(j.date)} не може да се книжи, менува или брише. Прво отворете го периодот во ДДВ-04.`);
  }
}
