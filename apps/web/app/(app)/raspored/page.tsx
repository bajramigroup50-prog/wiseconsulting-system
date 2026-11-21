/**
 * „Распоред (класа 8 и 9)“ of the old program's „Затворање на ставки“ menu: the same year close as „Затворање на
 * класа 4 и 7“ (one closing nalog closes 4 / 7 into 8 and distributes 8 → tax → 9), opened at that step.
 */
import { redirect } from 'next/navigation';
import { booksPage } from '@/lib/books';

export default async function RasporedPage() {
  await booksPage('raspored');
  redirect('/mbyllja#raspored');
}
