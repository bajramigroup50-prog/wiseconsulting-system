/** Menu entry „🏭 Нова фактура од производство“ (Материјално › 🏭 Производство): a new production invoice. */
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/izlez?nov&prod=1');
}
