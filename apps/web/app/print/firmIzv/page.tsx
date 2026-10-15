/** Print view (browser print / „⬇ PDF“ on the server / „📤 Испрати“) of „🗂 Целосен извештај за фирма“ — owner only. */
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { fiAi, fiHtml, fiOwnerUser, fiParams, fiReport } from '../../(app)/firmIzv/lib';

export const metadata = { title: 'Целосен извештај за фирма' };

export default async function PrintFirmIzv({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await fiOwnerUser();
  if (!u) {
    const u0 = await requireUser();
    if (u0.role === 'klient' || u0.role === 'teren') notFound();
    return <div className="pdfdoc"><p>{OWNER_ONLY_MSG}</p></div>;
  }
  const p = fiParams(await searchParams);
  if (!p.f) notFound();
  const [R, ai] = await Promise.all([fiReport(u, { ...p, f: p.f }), fiAi(p.f, p.y)]);
  if (!R) notFound();
  return (
    <div className="pdfdoc">
      <style dangerouslySetInnerHTML={{ __html: '.pdfdoc .frep table{font-size:8.5pt}.pdfdoc .frep details>summary{list-style:none}.pdfdoc .frep .card{box-shadow:none;border:1px solid #d0d5dd;break-inside:auto}.pdfdoc .frep h2,.pdfdoc .frep h3{break-after:avoid}' }} />
      <div dangerouslySetInnerHTML={{ __html: fiHtml(R, 'print', ai?.status === 'done' ? ai : null, u.name) }} />
    </div>
  );
}
