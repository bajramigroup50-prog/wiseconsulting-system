/**
 * Legacy `ACT.frCmr` (14557): CMR — меѓународен товарен лист (international consignment note) of a freight tour, with
 * the carrier's stamp in box 23 (legacy `f.stamp` → `firm.settings.stamp`, a `files.id` or URL).
 */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { frCountryName } from '@wise/core/industry';
import { invoicePrintImg } from '@wise/core/sales';
import { fleetVehicles, freightTours, partners } from '@wise/db';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';

const CSS = `.cmr{width:100%;border-collapse:collapse;font-size:9.5px}.cmr td{border:1px solid #111;vertical-align:top;padding:3px 4px}.cmr .cn{font-weight:700;font-size:11px;float:left;margin-right:4px}.cmr .cl{color:#444;font-size:8px;line-height:1.15}.cmr .cv{font-size:11px;margin-top:3px;min-height:14px}.cmr .gr td{height:150px}.cmrh{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:4px}.cmrh b{font-size:22px;letter-spacing:2px}`;
const fq = (v: string | number) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: 3 });
const lines = (s: string | null | undefined) => String(s ?? '').split(/,\s*/).map((x, i, a) => <span key={i}>{x}{i < a.length - 1 && <>,<br /></>}</span>);

function B({ n, lab, children, style }: { n: number; lab: string; children?: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={style}><div className="cn">{n}</div><div className="cl">{lab}</div><div className="cv">{children}</div></td>;
}

export default async function Cmr({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const g = await industryPage('frTuri', 'CMR');
  if (g.blocked || !id) notFound();
  const f = g.firm;
  const stamp = String(((f.settings ?? {}) as Record<string, unknown>).stamp ?? '').trim();
  const [t] = await db().select().from(freightTours).where(and(eq(freightTours.id, id), eq(freightTours.firmId, f.id))).limit(1);
  if (!t) notFound();
  const [[v], [p]] = await Promise.all([
    t.vehicleId ? db().select().from(fleetVehicles).where(eq(fleetVehicles.id, t.vehicleId)).limit(1) : Promise.resolve([]),
    t.partnerId ? db().select().from(partners).where(eq(partners.id, t.partnerId)).limit(1) : Promise.resolve([]),
  ]);
  return (
    <>
      <style>{CSS}</style>
      <div className="cmrh"><div>МЕЃУНАРОДЕН ТОВАРЕН ЛИСТ<br /><small>INTERNATIONAL CONSIGNMENT NOTE</small></div><b>CMR</b><div style={{ textAlign: 'right' }}>Бр. / No. <b style={{ fontSize: 14, letterSpacing: 0 }}>{t.number}</b></div></div>
      <table className="cmr"><tbody>
        <tr><B n={1} lab="Испраќач (име, адреса, земја) / Sender" style={{ width: '50%', height: 90 }}>{lines(t.sender)}</B>
          <td rowSpan={2} style={{ fontSize: 8, color: '#444' }}>Овој превоз, без оглед на спротивните клаузули, е предмет на Конвенцијата за договорот за меѓународен превоз на стоки по патишта (CMR).<br />This carriage is subject, notwithstanding any clause to the contrary, to the Convention on the Contract for the International Carriage of Goods by Road (CMR).</td></tr>
        <tr><B n={2} lab="Примач (име, адреса, земја) / Consignee" style={{ height: 90 }}>{lines(t.consignee)}</B></tr>
        <tr><B n={3} lab="Место на испорака / Place of delivery">{t.unloadPlace}{t.unloadC ? ', ' + frCountryName(t.unloadC) : ''}</B>
          <B n={16} lab="Превозник (име, адреса, земја) / Carrier" style={{ height: 90 }}>{f.name}<br />{[f.address, f.city].filter(Boolean).join(', ')}, Македонија<br />ЕДБ {f.edb ?? ''}{v && <><br />Возило: <b>{v.plate}{t.trailer ? ' / ' + t.trailer : ''}</b></>}</B></tr>
        <tr><B n={4} lab="Место и датум на преземање / Place and date of taking over">{t.loadPlace}{t.loadC ? ', ' + (t.loadC === 'MK' ? 'Македонија' : frCountryName(t.loadC)) : ''}<br />{dmy(t.date)}</B>
          <B n={17} lab="Следни превозници / Successive carriers" /></tr>
        <tr><B n={5} lab="Приложени документи / Documents attached">{t.docsAtt}</B><B n={18} lab="Забелешки на превозникот / Carrier's reservations" style={{ height: 50 }} /></tr>
        <tr><td colSpan={2} style={{ padding: 0 }}><table className="cmr" style={{ border: 0 }}><tbody><tr className="gr">
          <B n={6} lab="Ознаки и броеви / Marks and Nos" /><B n={7} lab="Број на колети / Number of packages">{t.packages}</B><B n={8} lab="Начин на пакување / Method of packing" />
          <B n={9} lab="Вид на стока / Nature of the goods" style={{ width: '30%' }}>{t.goods}{t.adr && <><br />ADR: {t.adr}</>}</B><B n={10} lab="Стат. број / Statistical No" />
          <B n={11} lab="Бруто тежина кг / Gross weight kg">{t.kg ? fq(t.kg) : ''}</B><B n={12} lab="Волумен m³ / Volume m³">{t.m3 ? fq(t.m3) : ''}</B>
        </tr></tbody></table></td></tr>
        <tr><B n={13} lab="Упатства од испраќачот / Sender's instructions" style={{ height: 70 }} /><B n={19} lab="Посебни договори / Special agreements">{t.orderNo ? 'Нарачка / Order: ' + t.orderNo : ''}</B></tr>
        <tr><B n={14} lab="Начин на плаќање / Instructions as to payment">Налогодавач / Ordered by: {p?.name ?? ''}</B><B n={20} lab="Да плати / To be paid by" /></tr>
        <tr><B n={21} lab="Составено во / Established in">{f.city ?? ''} · {dmy(t.date)}</B><B n={15} lab="Наплата при испорака / Cash on delivery" /></tr>
      </tbody></table>
      <table className="cmr" style={{ marginTop: -1 }}><tbody><tr>
        <B n={22} lab="Потпис и печат на испраќачот / Signature and stamp of the sender" style={{ height: 120, width: '33%' }} />
        <B n={23} lab="Потпис и печат на превозникот / Signature and stamp of the carrier" style={{ width: '33%' }}>{stamp && <img src={invoicePrintImg(stamp)} alt="" style={{ maxHeight: 60 }} />}</B>
        <B n={24} lab="Стоката е примена – место, датум, потпис и печат / Goods received" style={{ width: '34%' }}>{t.unloadDate ? dmy(t.unloadDate) : ''}</B>
      </tr></tbody></table>
    </>
  );
}
