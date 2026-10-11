/**
 * Legacy `tbPdfHTML` (travel contract of a booking) and `taProgHTML` + `taPaxHTML` (programme and passenger list of
 * an arrangement): `?id=<booking>` or `?arr=<arrangement>`.
 */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { bookingPax, bookingTotal, nationalityName } from '@wise/core/industry';
import { firmTravelConfig, partners, travelArrangements, travelBookings } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead, Signs } from '@/components/industry-print';

export default async function TravelPrint({ searchParams }: { searchParams: Promise<{ id?: string; arr?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('tura', 'Договор за патување');
  if (g.blocked) notFound();
  const C = firmTravelConfig(g.firm);
  const [b] = sp.id ? await db().select().from(travelBookings).where(and(eq(travelBookings.id, sp.id), eq(travelBookings.firmId, g.firm.id))).limit(1) : [];
  const aid = b?.arrangementId ?? sp.arr;
  if (!aid) notFound();
  const [A] = await db().select().from(travelArrangements).where(and(eq(travelArrangements.id, aid), eq(travelArrangements.firmId, g.firm.id))).limit(1);
  if (!A) notFound();
  const prog = (
    <>
      <table><tbody><tr><td style={{ width: '30%' }}>Аранжман</td><td><b>{A.code} {A.name}</b></td></tr><tr><td>Дестинација</td><td>{A.dest}</td></tr><tr><td>Период</td><td>{dmy(A.from)} – {dmy(A.to)}</td></tr></tbody></table>
      {A.prog && <><h2>Програма</h2><div style={{ whiteSpace: 'pre-line' }}>{A.prog}</div></>}
      {A.incl && <><h2>Цената вклучува</h2><div style={{ whiteSpace: 'pre-line' }}>{A.incl}</div></>}
      {A.excl && <><h2>Цената не вклучува</h2><div style={{ whiteSpace: 'pre-line' }}>{A.excl}</div></>}
    </>
  );
  if (!b) {
    const B = (await db().select().from(travelBookings).where(eq(travelBookings.arrangementId, A.id))).filter((x) => x.status !== 'cancel');
    const pax = B.flatMap((x) => (x.pax.length ? x.pax : [{ name: x.client.name }]).map((p) => ({ ...p, bk: x.number, phone: x.client.phone })));
    return (
      <>
        <DocHead firm={g.firm} title="ПРОГРАМА НА ПАТУВАЊЕ" sub={A.code} />
        {prog}
        <h2>Листа на патници ({pax.length})</h2>
        <table><thead><tr><th>Р.бр</th><th>Име и презиме</th><th>Датум на раѓање</th><th>Државјанство</th><th>Пасош</th><th>Важи до</th><th>Пријава</th><th>Телефон</th></tr></thead>
          <tbody>{pax.map((p, i) => <tr key={i}><td>{i + 1}</td><td>{p.name}</td><td>{dmy((p as { birth?: string }).birth)}</td><td>{nationalityName((p as { nat?: string }).nat)}</td><td>{(p as { doc?: string }).doc}</td><td>{dmy((p as { docExp?: string }).docExp)}</td><td>{p.bk}</td><td>{p.phone}</td></tr>)}</tbody></table>
      </>
    );
  }
  // legacy `tbPdfHTML` 11914: sections 1–5, includes / excludes, general terms, guarantee, declaration
  const [pt] = b.partnerId ? await db().select({ name: partners.name }).from(partners).where(eq(partners.id, b.partnerId)) : [];
  const tot = bookingTotal(b, A), paid = b.pays.reduce((s, p) => s + p.amt, 0);
  const f = g.firm;
  const th = (t: string) => <tr><th colSpan={4} style={{ textAlign: 'left', background: '#eee' }}>{t}</th></tr>;
  return (
    <>
      <DocHead firm={f} title="ДОГОВОР ЗА ПАТУВАЊЕ" sub={`бр. ${b.number} од ${dmy(b.date)}`} />
      <table style={{ fontSize: '9pt' }}><tbody>
        {th('1. Организатор на патувањето')}
        <tr><td colSpan={4}><b>{f.name}</b>, {f.address ?? ''}{f.city ? ', ' + f.city : ''} · ЕДБ {f.edb ?? ''}{f.phone ? ' · тел. ' + f.phone : ''}{C.lic ? ' · Лиценца за туристичка агенција бр. ' + C.lic : ''}</td></tr>
        {th('2. Патник – носител на договорот')}
        <tr><td style={{ width: '22%' }}>Име и презиме</td><td style={{ width: '30%' }}><b>{b.client.name}</b></td><td style={{ width: '18%' }}>Телефон</td><td><b>{b.client.phone}</b></td></tr>
        <tr><td>Адреса</td><td>{b.client.addr}</td><td>Е-пошта</td><td>{b.client.email}</td></tr>
        {pt && <tr><td>Плаќа</td><td colSpan={3}>{pt.name}</td></tr>}
        {th('3. Патување')}
        <tr><td>Аранжман</td><td colSpan={3}><b>{A.code} {A.name}</b></td></tr>
        <tr><td>Дестинација</td><td>{A.dest}</td><td>Период</td><td><b>{dmy(A.from)} – {dmy(A.to)}</b></td></tr>
        {(b.room || b.note) && <tr><td>Сместување / забелешка</td><td colSpan={3}>{[b.room, b.note].filter(Boolean).join(' · ')}</td></tr>}
        {th('4. Патници')}
        <tr><td colSpan={4}><table style={{ fontSize: '8.5pt', margin: 0 }}><thead><tr><th>#</th><th>Име и презиме</th><th>Датум на раѓање</th><th>Државјанство</th><th>Пасош бр.</th><th>Важи до</th></tr></thead>
          <tbody>{b.pax.filter((p) => p.name).map((p, i) => <tr key={i}><td>{i + 1}</td><td>{p.name}</td><td>{dmy(p.birth ?? '')}</td><td>{nationalityName(p.nat)}</td><td>{p.doc}</td><td>{dmy(p.docExp ?? '')}</td></tr>)}</tbody></table></td></tr>
        {th('5. Цена и плаќање')}
        <tr><td>Возрасни / деца</td><td>{b.adults} × {fmt(A.price ?? 0)}{b.children ? ` · ${b.children} × ${fmt(A.priceCh ?? A.price ?? 0)}` : ''}</td><td>Доплата / попуст</td><td>{fmt(b.extra ?? 0)} / {fmt(b.disc ?? 0)}</td></tr>
        <tr><td><b>Вкупна цена</b></td><td><b>{fmt(tot)} ден.</b></td><td>Уплатено</td><td>{fmt(paid)} ден.</td></tr>
        <tr><td><b>Остаток</b></td><td colSpan={3}><b>{fmt(tot - paid)} ден.</b> – најдоцна според условите (т. 2)</td></tr>
      </tbody></table>
      {A.incl && <p style={{ fontSize: '8.5pt', margin: '6px 0 2px' }}><b>Цената вклучува:</b> {A.incl}</p>}
      {A.excl && <p style={{ fontSize: '8.5pt', margin: '2px 0' }}><b>Цената не вклучува:</b> {A.excl}</p>}
      <h2 style={{ fontSize: '10pt', margin: '8px 0 2px' }}>Општи услови</h2><div style={{ fontSize: '7.8pt', whiteSpace: 'pre-line', lineHeight: 1.3 }}>{C.terms}</div>
      {C.guar && <p style={{ fontSize: '8pt' }}><b>Гаранција / осигурување на патниците:</b> {C.guar}</p>}
      <p style={{ fontSize: '8pt' }}>Патникот изјавува дека ја примил програмата на патувањето и општите услови, дека се согласни и дека податоците за патниците се точни.{A.kind === 'own' && f.vatRegistered ? ' Посебна постапка за оданочување на туристички агенции (чл. 38 ЗДДВ) – ДДВ не се искажува.' : ''}</p>
      <Signs L={['Организатор', 'Патник']} />
    </>
  );
}
