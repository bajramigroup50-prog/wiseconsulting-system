/** Legacy `VIEWS.devizni` 4888 (`m=>VIEWS.banka(m)` with FX accounts) — Финансово › Девизни изводи. */
import { BankView, type BankSP } from '../banka/bank-view';

export default async function DevizniPage({ searchParams }: { searchParams: Promise<BankSP> }) {
  return <BankView fx sp={await searchParams} />;
}
