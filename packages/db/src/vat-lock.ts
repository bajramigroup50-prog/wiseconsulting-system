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

/**
 * Source type of the VAT-close journal (posted by `closeVatPeriod`). Defined here (not in `vat-source.ts`, which
 * re-exports it) so the posting service → lock import chain does not pull in the document tables.
 */
export const VAT_CLOSE_SOURCE = 'vatPeriod';

/**
 * Document source types whose journals feed ДДВ-04 (legacy `vatCol`) — exactly the `sourceType` strings the
 * document services pass to `postJournal`, and exactly the documents `documentsVatSource` reads:
 * - `invoice`: invoices / credit notes / advance invoices (`sales/invoices.ts`);
 * - `purchase`: incoming invoices and import calculations (`sales/purchases.ts`);
 * - `supplier_credit`: supplier returns and credits (`sales/supplier-credits.ts`);
 * - `sales_daily`: POS days and Z / periodic fiscal reports (`stock-docs.ts` `saveSalesDay`);
 * - `cash_voucher`: cash register vouchers (`bank/cash.ts` `CASH_SOURCE_TYPE`).
 * Every other journal (manual nalog, bank statement, compensation, payroll, stock journals `stock:*`, …) counts for
 * VAT only through the lines it posts on VAT kontos (ledger fallback in `defaultVatSource`).
 */
export const VAT_SOURCE_TYPES: ReadonlySet<string> = new Set(['invoice', 'purchase', 'supplier_credit', 'sales_daily', 'cash_voucher']);

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
