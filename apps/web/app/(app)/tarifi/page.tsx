/**
 * Legacy `VIEWS.tarifi` — Шифрарник › Даночни тарифи. The final legacy definition (12844) is the editable VAT-konto
 * table (it replaced the static 6975 list), so this route renders the same editor as ДДВ-04 › Даночни тарифи.
 */
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { booksPage } from '@/lib/books';
import { sysViewAllowed } from '@/lib/nav-system';
import { NoFirm } from '@/components/no-firm';
import { TarifiView } from '../ddv/tarifi-view';

export default async function TarifiPage() {
  const u0 = await requireUser();
  if (!sysViewAllowed(u0.role, 'tarifi')) notFound();
  const { u, firm } = await booksPage('ddv');
  if (!firm) return <NoFirm t="Даночни тарифи" />;
  return <TarifiView firm={firm} u={u} back={{ href: '/sifrarnik', label: '← Шифрарник' }} />;
}
