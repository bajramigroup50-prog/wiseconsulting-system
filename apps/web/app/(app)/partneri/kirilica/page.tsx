/**
 * Комитенти › Поправка на кирилица: names, addresses and cities of the current firm's partners that are in Latin
 * (typed on a Macedonian keyboard in Latin mode, or imported in Latin) or still have YUSCII leftovers → Cyrillic.
 * Real foreign companies („Microsoft Ireland“) are listed unticked. Modelled on Фирми › Поправка на увезени фирми.
 */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { partnerCyrFix } from '@wise/core/text/partner-cyr';
import { partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { applyPartnerCyr } from './actions';

const LIMIT = 500;
const T = 'Поправка на кирилица';

export default async function PartneriKirilicaPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('partneri');
  if (!firm) return <NoFirm t={T} />;
  const back = <Link className="btn" href="/partneri">← Комитенти</Link>;
  if (!canDo(u, 'write', firm.id)) return <><Hd t={T}>{back}</Hd><div className="callout warn">Немате право да менувате комитенти.</div></>;
  const all = await db().select({ id: partners.id, code: partners.code, name: partners.name, address: partners.address, city: partners.city,
    edb: partners.edb, country: partners.country, foreign: partners.foreign }).from(partners).where(eq(partners.firmId, firm.id)).orderBy(asc(partners.name));
  const fixes = all.map((p) => ({ p, f: partnerCyrFix(p) })).filter(({ f }) => f.changed);
  const rows = fixes.slice(0, LIMIT);
  const nForeign = fixes.filter(({ f }) => f.foreign).length;
  const btn = <button className="btn pri">✓ Конвертирај ги штиклираните</button>;
  return (
    <>
      <Hd t={T} sub={`${fixes.length} комитенти за поправка${nForeign ? ` (${nForeign} изгледаат странски – не се штиклирани)` : ''}`}>{back}</Hd>
      {sp.done && <div className="callout good" role="status">✓ Конвертирани {sp.done} комитенти.</div>}
      <div className="callout">Називот, адресата и градот се претвораат во кирилица:
        текст пишуван на македонска тастатура во латиница (<b>[</b>→Ш, <b>]</b>→Ѓ, <b>;</b>→Ч, <b>&apos;</b>→Ќ, <b>\</b>→Ж, <b>W</b>→Њ, <b>Q</b>→Љ, <b>X</b>→Џ, <b>Y</b>→Ѕ – пр. „MA[INA“ → „МАШИНА“)
        се претвора копче по копче; другата латиница буква по буква (Bajrami → Бајрами, Shtip → Штип, Xhemaili → Џемаили);
        остатоци од стариот YUSCII фонт во кирилица се поправаат („ДЕЛ^ЕВ“ → „ДЕЛЧЕВ“).
        Странските фирми (ознака „странски“, држава, даночен број што не е ЕДБ од 13 цифри, или Ltd / GmbH / LLC / Microsoft…) не се штиклирани – нивниот назив останува на латиница.
        Прегледајте, поправете каде што треба и штиклирајте само тоа што треба да се промени.</div>
      {rows.length === 0 ? <div className="callout good">✓ Сите комитенти се на кирилица.</div> : (
        <form action={applyPartnerCyr} className="card">
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>{btn}</div>
          <div className="tw">
            <table className="dense">
              <thead><tr><th></th><th>Шифра</th><th>Сега</th><th>Назив (кирилица)</th><th>Адреса (кирилица)</th><th>Град (кирилица)</th></tr></thead>
              <tbody>
                {rows.map(({ p, f }) => (
                  <tr key={p.id}>
                    <td><input type="checkbox" name="pick" value={p.id} defaultChecked={!f.foreign} aria-label="Конвертирај" style={{ width: 'auto' }} /></td>
                    <td className="mini">{p.code}</td>
                    <td className="mut" style={{ fontSize: 12 }}>{p.name}<br />{[p.address, p.city].filter(Boolean).join(', ')}
                      {p.edb && <><br />ЕДБ {p.edb}</>}
                      {f.foreign && <><br /><span className="pill warn" title="Затоа не е штиклиран">🌍 {f.foreign}</span></>}</td>
                    <td><input name={`name.${p.id}`} defaultValue={f.name} style={{ minWidth: 220 }} /></td>
                    <td><input name={`address.${p.id}`} defaultValue={f.address} /></td>
                    <td><input name={`city.${p.id}`} defaultValue={f.city} style={{ maxWidth: 160 }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fixes.length > LIMIT && <p className="mini">Прикажани се првите {LIMIT} од {fixes.length}; останатите се појавуваат по конвертирањето.</p>}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>{btn}</div>
        </form>
      )}
    </>
  );
}
