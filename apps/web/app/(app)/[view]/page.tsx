import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { NAV_LBL, viewAllowed } from '@/lib/nav';
import { Hd } from '@/components/hd';

/** Every legacy menu item that hasn't been ported yet lands here. */
export default async function NotPortedYet({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  const u = await requireUser();
  const label = NAV_LBL[view];
  if (!label || !viewAllowed(u.role, view)) notFound();
  return (
    <>
      <Hd t={label} />
      <div className="card empty">
        Овој модул сè уште се пренесува од старата програма. Додека да биде готов, користете ја постоечката верзија.
      </div>
    </>
  );
}
