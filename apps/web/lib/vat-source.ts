import 'server-only';
/**
 * The VAT document source used by the ДДВ-04, VAT books and period-close screens.
 *
 * The implementations live in `@wise/db` (`vat-source.ts`) so the close service, the autopilot estimate and the
 * PGlite tests use the same code: documents (invoices, purchases, supplier credits, Z reports, cash vouchers) plus
 * the journals on VAT kontos that no document posted (manual nalozi, bank, compensations).
 */
import { defaultVatSource, type VatDocumentSource } from '@wise/db';

export const vatSource: VatDocumentSource = defaultVatSource;

/** Shown on the VAT screens when VAT postings outside the documents (manual nalozi etc.) were included. */
export const vatLedgerNote = (n: number) =>
  `Вклучени се и ${n} ${n === 1 ? 'налог' : 'налози'} без документ што книжат на ДДВ конта (рачни налози, изводи, компензации) – пресметани од ДДВ ставката; промет по 0% / ослободен промет од нив не се гледа.`;
