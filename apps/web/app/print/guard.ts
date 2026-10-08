import 'server-only';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { currentFirm, currentYear } from '@/lib/context';
import { viewAllowed } from '@/lib/nav';

/** Print views use the same guard as the screen they print (view permission + current firm). */
export async function printGuard(view: string) {
  const u = await requireUser();
  if (!viewAllowed(u.role, view)) notFound();
  const firm = await currentFirm(u);
  if (!firm) notFound();
  return { u, firm, year: await currentYear() };
}
