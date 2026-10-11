/** Print view (browser print / „⬇ PDF“ on the server) of 📊 Продуктивност на вработените — owner only. */
import { notFound } from 'next/navigation';
import { dmy } from '@/lib/fmt';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { loadProductivity, ownerGate, prodFilter, userName } from '../../(app)/produktivnost/data';
import { ReportView } from '../../(app)/produktivnost/report-view';

export const metadata = { title: 'Продуктивност на вработените' };

export default async function PrintProduktivnost({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { u, ok } = await ownerGate();
  if (u.role === 'klient' || u.role === 'teren') notFound();
  if (!ok) return <div className="pdfdoc"><p>{OWNER_ONLY_MSG}</p></div>;
  const f = prodFilter(await searchParams);
  const D = await loadProductivity(f);
  const fl = [f.user ? `корисник: ${userName(D, f.user === '-' ? null : f.user)}` : '', f.firm ? `фирма: ${D.firms.get(f.firm) ?? ''}` : ''].filter(Boolean).join(' · ');
  return (
    <div className="pdfdoc land">
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape} .pdfdoc table{font-size:8.5pt} .pdfdoc details>summary{list-style:none}' }} />
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: '14pt', fontWeight: 700 }}>ПРОДУКТИВНОСТ НА ВРАБОТЕНИТЕ</div>
        <div style={{ fontSize: '9pt' }}>период {dmy(f.from)} – {dmy(f.to)}{fl ? ` · ${fl}` : ''} · изработено {dmy(new Date().toISOString())}</div>
      </div>
      <ReportView D={D} f={f} print />
    </div>
  );
}
