/**
 * Where bank matching gets its open invoices / purchases from.
 *
 * Phase 3 builds the invoice and purchase tables in parallel, so for now open items are computed from the
 * ledger (`ledgerOpenItems` in `@wise/core`): partner balances on 120–128 / 220–228 per document reference.
 * Bank-statement journals are excluded — bank payments are counted from the bank lines (`bankPaid`).
 *
 * TODO(merge): after Phase 3 is merged, implement `documentOpenItemsSource` over the invoice / purchase
 * tables (total = invoice total, paidOther = credit notes, compensations, cash, journal refs; `cash`,
 * `pend`, `imp`, `supKonto`, `cur`, `fx` from the documents) and make it the default with
 * `setOpenItemsSource(documentOpenItemsSource)`. Bank-line refs created against ledger items
 * (`L|konto|partner|doc` ids) can be re-pointed with `parseLedgerItemId` + the document number.
 */
import { ledgerOpenItems, type OpenDoc } from '@wise/core';
import type { Tx } from '../audit';
import { loadLedgerLines } from '../ledger-queries';

export interface OpenItems { invoices: OpenDoc[]; purchases: OpenDoc[] }

export interface OpenItemsOptions {
  /** Ignore what these journals booked (e.g. the compensation being edited). */
  excludeJournalIds?: readonly string[];
}

export interface OpenItemsSource {
  readonly name: string;
  /** Open (and recently closed) documents of the firm for the business year. Amounts in cents. */
  load(tx: Tx, firmId: string, year: number, opts?: OpenItemsOptions): Promise<OpenItems>;
}

export const BANK_SOURCE_TYPE = 'bank_statement';

/** Open items from the persisted ledger (stopgap until the document tables exist). */
export const ledgerOpenItemsSource: OpenItemsSource = {
  name: 'ledger',
  async load(tx, firmId, year, opts) {
    const L = await loadLedgerLines(tx, firmId, `${year}-01-01`, `${year}-12-31`);
    const ex = new Set(opts?.excludeJournalIds ?? []);
    return ledgerOpenItems(L, { exclude: (l) => l.sourceType === BANK_SOURCE_TYPE || (!!l.journalId && ex.has(l.journalId)) });
  },
};

let current: OpenItemsSource = ledgerOpenItemsSource;

/** The source used by matching, manual linking, advances and payment-order suggestions. */
export const openItemsSource = (): OpenItemsSource => current;
/** Switch the source (coordinator, after Phase 3 is merged; tests). */
export const setOpenItemsSource = (s: OpenItemsSource): void => { current = s; };
