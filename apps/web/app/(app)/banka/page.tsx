/** Legacy `VIEWS.banka` — Финансово › Изводи (денарски). */
import { BankView, type BankSP } from './bank-view';

export default async function BankaPage({ searchParams }: { searchParams: Promise<BankSP> }) {
  return <BankView fx={false} sp={await searchParams} />;
}
