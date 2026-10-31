/**
 * „📊 Извештаи“ – every report of the program in one place (`lib/reports-registry.ts`): by group, a search, ⭐ favourites
 * (kept in this browser) and one period „од – до“ that the reports taking a period open with. Only the reports the user
 * may open are listed (`viewAllowed` + the per-user view list); each opens its own screen with its own access rules.
 */
import { booksPage } from '@/lib/books';
import { viewSeer } from '@/lib/can-see';
import { viewAllowed } from '@/lib/nav';
import { REPORT_GROUPS } from '@/lib/reports-registry';
import { Hd } from '@/components/hd';
import { ReportsHub } from './hub';

export const metadata = { title: 'Извештаи' };

export default async function IzvestaiPage() {
  const { u, year } = await booksPage('izvestai');
  const see = await viewSeer();
  const groups = REPORT_GROUPS.map(([g, L]) => [g, L.filter((r) => viewAllowed(u.role, r.acc ?? r.view) && see(r.acc ?? r.view))] as const).filter(([, L]) => L.length > 0);
  return (
    <>
      <Hd t="📊 Извештаи" sub="сите извештаи на едно место" exp={false} />
      <ReportsHub groups={groups.map(([g, L]) => [g, [...L]])} year={year} />
    </>
  );
}
