/** Menu entry „skanIzlez“: scanning of outgoing invoices – the screen made for them. */
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/skan?k=sale');
}
