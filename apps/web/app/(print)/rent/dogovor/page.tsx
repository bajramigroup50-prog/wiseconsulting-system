/**
 * Legacy `rcPdfHTML` 11727 / `rcPdfDoc` 11720: ДОГОВОР ЗА ИЗНАЈМУВАЊЕ НА ВОЗИЛО (лист 1: изнајмувач, корисник / возач,
 * возило и период, државите на патување, цена и плаќање, услови, изјава) + ЗАПИСНИК ЗА ПРИМОПРЕДАВАЊЕ (лист 2:
 * предавање / враќање со км, гориво во осмини, оштетувања, скица, опрема и документи, фотографии, потписи).
 * `n=2` prints two copies („ПРИМЕРОК ЗА КОРИСНИКОТ“ / „ПРИМЕРОК ЗА ИЗНАЈМУВАЧОТ“).
 */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { rcCalc, RENT_CHECKLIST, rentAbroad, rentCountryName } from '@wise/core/industry';
import { firmRentConfig, fleetVehicles, partners, rentRentals, vehicleRates, type RentRental } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead, Signs } from '@/components/industry-print';

const FuelBar = ({ v }: { v: unknown }) => {
  const x = v === '' || v == null ? null : Number(v);
  return <svg width="120" height="16" viewBox="0 0 120 16" style={{ verticalAlign: 'middle' }}>{[...Array(8)].map((_, i) => <rect key={i} x={i * 15} y={2} width={13} height={12} fill={x != null && i < x ? '#333' : '#fff'} stroke="#333" strokeWidth={1} />)}</svg>;
};
const CAR = `<svg viewBox="0 0 520 210" width="100%" style="max-width:520px;height:auto" fill="none" stroke="#333" stroke-width="1.4"><text x="60" y="14" font-size="10" fill="#333" stroke="none">ЛЕВО</text><text x="60" y="206" font-size="10" fill="#333" stroke="none">ДЕСНО</text><text x="400" y="14" font-size="10" fill="#333" stroke="none">ПРЕДНО / ЗАДНО</text><path d="M20 60 q10-28 60-30 h120 q40 0 70 26 l30 4 q20 4 20 20 v10 h-300 z"/><circle cx="85" cy="90" r="16"/><circle cx="250" cy="90" r="16"/><path d="M95 32 l20-0 0 26 h-50 q10-22 30-26z M125 32 h70 q25 2 45 24 h-115z"/><g transform="translate(340,100) scale(-1,1)"><path d="M20 60 q10-28 60-30 h120 q40 0 70 26 l30 4 q20 4 20 20 v10 h-300 z"/><circle cx="85" cy="90" r="16"/><circle cx="250" cy="90" r="16"/><path d="M95 32 l20-0 0 26 h-50 q10-22 30-26z M125 32 h70 q25 2 45 24 h-115z"/></g><rect x="380" y="24" width="110" height="80" rx="18"/><rect x="398" y="36" width="74" height="26" rx="4"/><circle cx="395" cy="82" r="6"/><circle cx="475" cy="82" r="6"/><rect x="380" y="120" width="110" height="80" rx="18"/><rect x="398" y="130" width="74" height="22" rx="4"/><rect x="390" y="172" width="22" height="10"/><rect x="458" y="172" width="22" height="10"/></svg>`;

export default async function RentContract({ searchParams }: { searchParams: Promise<{ id?: string; n?: string }> }) {
  const { id, n } = await searchParams;
  const g = await industryPage('rent', 'Договор');
  if (g.blocked || !id || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [r] = await db().select().from(rentRentals).where(and(eq(rentRentals.id, id), eq(rentRentals.firmId, g.firm.id))).limit(1);
  if (!r) notFound();
  const [v] = await db().select().from(fleetVehicles).where(eq(fleetVehicles.id, r.vehicleId));
  const [pt] = r.partnerId ? await db().select({ name: partners.name }).from(partners).where(eq(partners.id, r.partnerId)) : [];
  const C = firmRentConfig(g.firm);
  const k = rcCalc(r, vehicleRates(v!), C);
  const f = g.firm;
  const S = (f.settings ?? {}) as Record<string, unknown>;
  const d = r.driver;
  const ct = r.countries.length ? r.countries : ['MK'];
  const abroad = rentAbroad(ct);
  const pd = k.days ? Math.round((k.rent / k.days) * 100) / 100 : 0;
  const val = (x: unknown) => (x ? String(x) : <span style={{ color: '#999' }}>__________________</span>);
  const dtt = (x: string | null | undefined) => (x ? String(x).replace('T', ' ').slice(0, 16) : '__________');
  const th = (t: string) => <tr><th colSpan={4} style={{ textAlign: 'left', background: '#eee' }}>{t}</th></tr>;
  const copies = n === '2' ? ['ПРИМЕРОК ЗА КОРИСНИКОТ', 'ПРИМЕРОК ЗА ИЗНАЈМУВАЧОТ'] : [''];
  const hrow = (kk: 'out' | 'ret', o: RentRental['out']) => <tr key={kk}><td><b>{kk === 'out' ? 'Предавање' : 'Враќање'}</b></td><td>{dtt(o.at)}</td><td>{o.km !== '' && o.km != null ? fq(Number(o.km)) : '________'}</td><td><FuelBar v={o.fuel} /> {o.fuel !== '' && o.fuel != null ? `${o.fuel}/8` : ''}</td><td>{o.dmg ?? ''}</td></tr>;
  return (
    <>{copies.map((cp, ci) => (
      <div key={ci}>
        {ci > 0 && <div className="pb" />}
        {cp && <div style={{ textAlign: 'right', fontSize: '8pt', fontWeight: 700, letterSpacing: '.5px' }}>{cp}</div>}
        <DocHead firm={f} title="ДОГОВОР ЗА ИЗНАЈМУВАЊЕ НА ВОЗИЛО" sub={`бр. ${r.number} од ${dmy(r.date)} · лист 1 од 2`} />
        <table style={{ fontSize: '9pt' }}><tbody>
          {th('1. Изнајмувач')}
          <tr><td colSpan={4}><b>{f.name}</b>, {f.address ?? ''}{f.city ? ', ' + f.city : ''} · ЕДБ {f.edb ?? ''}{f.phone ? ' · тел. ' + f.phone : ''}{S.bank ? ' · ж-с ' + String(S.bank) : ''}</td></tr>
          {th('2. Корисник / возач')}
          <tr><td style={{ width: '22%' }}>Име и презиме</td><td style={{ width: '28%' }}><b>{val(d.name)}</b></td><td style={{ width: '20%' }}>Датум на раѓање</td><td>{d.birth ? dmy(d.birth) : val('')}</td></tr>
          <tr><td>Државјанство</td><td>{val(d.nat)}</td><td>ЕМБГ</td><td>{val(d.embg)}</td></tr>
          <tr><td>{d.docType === 'id' ? 'Лична карта бр.' : 'Пасош бр.'}</td><td><b>{val(d.doc)}</b></td><td>Важи до / издаден од</td><td>{d.docExp ? dmy(d.docExp) : '____'}{d.docIss ? ' · ' + d.docIss : ''}</td></tr>
          <tr><td>Возачка дозвола бр.</td><td><b>{val(d.lic)}</b>{d.licCat ? ' · кат. ' + d.licCat : ''}</td><td>Издадена / важи до</td><td>{d.licFrom ? dmy(d.licFrom) : '____'} / {d.licExp ? dmy(d.licExp) : '____'}</td></tr>
          <tr><td>Адреса</td><td colSpan={3}>{val(d.addr)}</td></tr>
          <tr><td>Телефон за контакт</td><td><b>{val(d.phone)}</b></td><td>Е-пошта</td><td>{val(d.email)}</td></tr>
          <tr><td>Контакт во итен случај</td><td colSpan={3}>{val(d.emerg)}</td></tr>
          {r.driver2 && <tr><td>Дополнителен возач</td><td colSpan={3}>{r.driver2}</td></tr>}
          {pt && <tr><td>Плаќа (фирма)</td><td colSpan={3}>{pt.name}</td></tr>}
          {th('3. Возило и период')}
          <tr><td>Возило</td><td><b>{v?.plate ?? r.plate}</b> {v?.name ?? ''}</td><td>Шасија</td><td>{val('')}</td></tr>
          <tr><td>Преземање</td><td><b>{dtt(r.from)}</b></td><td>Враќање</td><td><b>{dtt(r.to)}</b></td></tr>
          <tr><td>Државите на патување</td><td colSpan={3}><b>{ct.map(rentCountryName).join(', ')}</b>{abroad ? (d.auth !== false ? ' · изнајмувачот го овластува корисникот да излезе од Р.С. Македонија со возилото' + (r.green ? ' · зелен картон предаден' : '') : '') : ' · излез од државата не е дозволен'}</td></tr>
          {th('4. Цена и плаќање')}
          <tr><td>Цена по ден</td><td>{fmt(pd)} ден.{k.pDayAgreed ? ' (договорена)' : ''}</td><td>Број на денови</td><td>{k.days}</td></tr>
          <tr><td>Изнајмување</td><td>{fmt(k.rent)} ден. со ДДВ</td><td>Километри</td><td>{Number(v?.rKm) ? `вклучени ${fq(Number(v!.rKm))} км/ден, над тоа ${fmt(v?.rKmX ?? 0)} ден./км` : 'неограничени'}</td></tr>
          {k.ex.map((x, i) => <tr key={i}><td>{x.name}</td><td colSpan={3}>{fq(x.qty)} × {fmt(x.price)} = {fmt(x.qty * x.price)} ден.</td></tr>)}
          <tr><td><b>Вкупно за плаќање</b></td><td><b>{fmt(k.tot)} ден.</b></td><td>Кауција (депозит)</td><td><b>{fmt(k.dep)} ден.</b></td></tr>
          <tr><td>Гориво</td><td colSpan={3}>Возилото се враќа со исто ниво на гориво; секоја осмина што недостасува {fmt(C.fuel8)} ден.</td></tr>
        </tbody></table>
        <h2 style={{ fontSize: '10pt', margin: '8px 0 2px' }}>5. Услови</h2>
        <div style={{ fontSize: '7.8pt', whiteSpace: 'pre-line', lineHeight: 1.3 }}>{C.terms}{abroad ? '\nЗа патување надвор од државата корисникот е должен да ги почитува прописите на државата во која се наоѓа; трошоците за патарини, винети и казни во странство се на товар на корисникот.' : ''}</div>
        <p style={{ fontSize: '8pt', margin: '6px 0' }}>Корисникот изјавува дека ги прочитал условите, дека податоците се точни и дека е согласен неговите лични податоци и копии од документите да се чуваат за потребите на овој договор.</p>
        <Signs L={['Изнајмувач', 'Корисник']} />
        <div className="pb" />
        {cp && <div style={{ textAlign: 'right', fontSize: '8pt', fontWeight: 700, letterSpacing: '.5px' }}>{cp}</div>}
        <DocHead firm={f} title="ЗАПИСНИК ЗА ПРИМОПРЕДАВАЊЕ НА ВОЗИЛОТО" sub={`кон договор бр. ${r.number} · ${v?.plate ?? r.plate} ${v?.name ?? ''} · лист 2 од 2`} />
        <table style={{ fontSize: '9pt' }}><thead><tr><th /><th>Датум и време</th><th>Км</th><th>Гориво</th><th>Оштетувања / забелешки</th></tr></thead>
          <tbody>{hrow('out', r.out)}{hrow('ret', r.ret)}{k.km > 0 && <tr><td colSpan={5}>Изминати: <b>{fq(k.km)} км</b>{k.xKm ? ` · над дозволените: ${fq(k.xKm)} км` : ''}</td></tr>}</tbody></table>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1.2 }}><div style={{ fontSize: '8.5pt', fontWeight: 700 }}>Означете ги оштетувањата на скицата (X = гребнатинка, O = вдлабнатина, // = кршено)</div><div dangerouslySetInnerHTML={{ __html: CAR }} /></div>
          <div style={{ flex: 1 }}><table style={{ fontSize: '8.5pt' }}><thead><tr><th>Опрема и документи</th><th>Пред.</th><th>Врак.</th></tr></thead>
            <tbody>{RENT_CHECKLIST.map((x) => <tr key={x}><td>{x}</td><td style={{ textAlign: 'center' }}>{x === 'Зелен картон' && r.green ? '☑' : '☐'}</td><td style={{ textAlign: 'center' }}>☐</td></tr>)}</tbody></table></div>
        </div>
        {(r.out.photos ?? []).length > 0 && <><div style={{ fontSize: '8.5pt', fontWeight: 700, marginTop: 6 }}>Фотографии при предавањето</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{r.out.photos!.slice(0, 8).map((p) => <img key={p} src={`/api/files/${p}`} alt="" style={{ width: 118, height: 80, objectFit: 'cover', border: '1px solid #999' }} />)}</div></>}
        <table style={{ fontSize: '9pt', marginTop: 10 }}><thead><tr><th style={{ width: '20%' }} /><th>Предал (изнајмувач)</th><th>Примил (корисник)</th></tr></thead>
          <tbody><tr><td><b>Предавање</b></td><td style={{ height: 44 }} /><td>{r.out.sig && <img src={`/api/files/${r.out.sig}`} alt="" style={{ height: 40 }} />}</td></tr>
            <tr><td><b>Враќање</b></td><td style={{ height: 44 }} /><td>{r.ret.sig && <img src={`/api/files/${r.ret.sig}`} alt="" style={{ height: 40 }} />}</td></tr></tbody></table>
        <p style={{ fontSize: '8pt', marginTop: 6 }}>При враќањето возилото е прегледано во присуство на корисникот. Утврдените оштетувања и недостатоци се наплаќаат согласно договорот{Number(k.dep) ? '; кауцијата се враќа по порамнувањето' : ''}.</p>
      </div>
    ))}</>
  );
}
