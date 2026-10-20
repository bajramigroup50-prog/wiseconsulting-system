/**
 * 🤝 IFAC – the office's quality manual for the year (ISQM 1: the nine components as documented and signed, with
 * version) and the readiness for the ИСОС quality-control review, for print / PDF.
 */
import { notFound } from 'next/navigation';
import { can } from '@wise/core';
import { formMeta, SQM_COMPONENTS, type SqmData } from '@wise/core/office/ifac-sqm';
import { ethicsStaff, getOfficeProfile, ifacReadinessFor, sqmYear } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isDemoUser } from '@/lib/demo';
import { dmy } from '@/lib/fmt';
import { viewAllowed } from '@/lib/nav';
import { allowedFirms, today } from '@/lib/office';
import { loadProvider } from '../../(app)/kdogovori/lib';

export const metadata = { title: 'Прирачник за квалитет' };

export default async function PrintIfac({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'ifac') || !can(u.principal, 'office', null)) notFound();
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.y ?? '') ? Number(sp.y) : new Date().getFullYear();
  const demo = isDemoUser(u);
  const [S, staff, P, O, F] = await Promise.all([db().transaction((tx) => sqmYear(tx, year)), db().transaction((tx) => ethicsStaff(tx, demo)), loadProvider(u), getOfficeProfile(db(), { demo }), allowedFirms(u, { year })]);
  const V = await db().transaction((tx) => ifacReadinessFor(tx, year, { firms: F.filter((f) => f.id !== P.off?.id).map((f) => ({ id: f.id, name: f.name })), today: today(), demo }));
  const nm = (id: unknown) => staff.find((x) => x.id === id)?.name ?? '—';
  return (
    <div className="pdfdoc">
      <style dangerouslySetInnerHTML={{ __html: '.pdfdoc table{font-size:9pt;width:100%;border-collapse:collapse}.pdfdoc td,.pdfdoc th{vertical-align:top;border:1px solid #bbb;padding:2px 4px}.pre{white-space:pre-wrap}' }} />
      <div style={{ textAlign: 'center', marginBottom: '4mm' }}>
        <div style={{ fontSize: '9pt' }}>{O.name}</div>
        <div style={{ fontSize: '15pt', fontWeight: 700 }}>ПРИРАЧНИК ЗА УПРАВУВАЊЕ СО КВАЛИТЕТ {year}</div>
        <div style={{ fontSize: '9pt' }}>ISQM 1 · ISRS 4410 (ревидиран) · Кодекс на етика IESBA · изработено {dmy(today())}</div>
      </div>
      <h2 style={{ fontSize: '11.5pt' }}>Подготвеност за проверка на квалитет: {V.pct}% ({V.done}/{V.total})</h2>
      {V.sections.map((s) => (
        <table key={s.k} style={{ marginBottom: '3mm' }}><thead><tr><th colSpan={3} style={{ textAlign: 'left' }}>{s.n} · {s.clause}</th></tr></thead>
          <tbody>{s.items.map((i, n) => <tr key={n}><td style={{ width: '6mm' }}>{i.ok ? '✓' : '✗'}</td><td>{i.n}</td><td>{i.info ?? ''}</td></tr>)}</tbody></table>
      ))}
      {SQM_COMPONENTS.map((c, i) => {
        const r = S.get(c.k), d = (r?.data ?? {}) as SqmData, m = formMeta(d);
        return (
          <div key={c.k} style={{ pageBreakInside: 'avoid', marginTop: '4mm' }}>
            <h2 style={{ fontSize: '11.5pt', margin: '0 0 1mm', borderBottom: '1px solid #999' }}>{i + 1}. {c.n} <span style={{ fontSize: '8.5pt', fontWeight: 400 }}>({c.clause})</span></h2>
            {c.fields.map((f) => <p key={f.k} style={{ margin: '0 0 1.5mm' }}><b>{f.n}:</b> <span className="pre">{d[f.k] ? (f.t === 'date' ? dmy(String(d[f.k])) : String(d[f.k])) : '⚠ не е внесено'}</span></p>)}
            <p style={{ fontSize: '8.5pt', margin: 0 }}>Одговорен: {nm(d.owner)} · Одобрил: {nm(d.signedBy)}{d.signedOn ? ` на ${dmy(String(d.signedOn))}` : ' ⚠ не е потпишано'} · верзија {m.v || '—'}</p>
          </div>
        );
      })}
      <table style={{ marginTop: '12mm', border: 0 }}><tbody><tr>
        <td style={{ width: '50%', border: 0 }}>Оперативна одговорност: ______________________</td><td style={{ border: 0 }}>Крајна одговорност (управител): ______________________</td>
      </tr></tbody></table>
    </div>
  );
}
