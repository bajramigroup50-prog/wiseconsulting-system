import 'server-only';
/**
 * The VAT document source used by the ДДВ-04, VAT books and period-close screens.
 *
 * The interface and implementations live in `@wise/db` (`vat-source.ts`) so the close service and its
 * PGlite tests use the same code. Until the document tables exist, VAT is read from the ledger.
 *
 * TODO(merge): when Phases 3 (invoices, purchases, supplier credits), 4 (cash vouchers) and 7 (Z reports)
 * are merged, implement `documentsVatSource` in `packages/db/src/vat-source.ts` (map rows to the
 * `@wise/core` document shapes; `pend` for client-submitted rows) and export it here instead of
 * `ledgerVatSource`. Optionally fall back to the ledger for years before the go-live date.
 */
import { ledgerVatSource, type VatDocumentSource } from '@wise/db';

export const vatSource: VatDocumentSource = ledgerVatSource;

/** Shown on the VAT screens while the ledger fallback is active. */
export const VAT_SOURCE_NOTE =
  'ДДВ се пресметува од книжените налози (ДДВ контата). Промет по 0% / извоз / ослободен промет и промет по чл. 32-а без ДДВ ставка не се гледаат додека не се поврзат документите (фактури, каса, благајна).';
