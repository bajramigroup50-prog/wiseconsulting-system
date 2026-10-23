/** Menu entry „skanFisk“: scanning of fiscal receipts paid in cash („📷 Сметки платени во готово“ in Благајна) – the screen made for them. */
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/blagajna#cash-scans');
}
