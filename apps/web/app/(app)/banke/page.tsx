/** Legacy `VIEWS.banke` 6983 = the bank-accounts list of „Изводи“ (`S.showBanks`). */
import { redirect } from 'next/navigation';

export default function BankePage() { redirect('/banka?banks=1'); }
