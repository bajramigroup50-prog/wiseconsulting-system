/** Фирми › Латиница → кирилица: names, addresses and cities typed on a Macedonian keyboard in Latin mode. */
import Link from 'next/link';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { can } from '@wise/core';
import { hasCyrillic, hasLatin, kbdToCyr } from '@wise/core/text/kbd-cyr';
import { firms, userFirms } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { applyCyr } from './actions';

const lat = (s: string | null) => !!s && hasLatin(s) && !hasCyrillic(s);

export default async function KirilicaPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  if (!can(u.principal, 'saveFirm')) return <><Hd t="Латиница → кирилица" /><div className="callout warn">Немате право да менувате фирми.</div></>;
  const scoped = u.principal.firms.includes('*')
    ? undefined
    : or(inArray(firms.id, db().select({ id: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))), eq(firms.ownerId, u.id));
  const rows = (await db().select({ id: firms.id, name: firms.name, address: firms.address, city: firms.city }).from(firms).where(scoped).orderBy(asc(firms.name)))
    .filter((f) => lat(f.name) || lat(f.address) || lat(f.city));
  return (
    <>
      <Hd t="Латиница → кирилица" sub={`${rows.length} фирми со латиница`}><Link className="btn" href="/firmi">← Фирми</Link></Hd>
      {sp.done && <div className="callout good" role="status">✓ Конвертирани {sp.done} фирми.</div>}
      <div className="callout">Називите, адресите и градовите се претвораат како да се пишувани на македонска тастатура во латиница
        (<b>[</b>→Ш, <b>]</b>→Ѓ, <b>;</b>→Ч, <b>&apos;</b>→Ќ, <b>\</b>→Ж, <b>W</b>→Њ, <b>Q</b>→Љ, <b>X</b>→Џ, <b>Y</b>→Ѕ). Прегледајте, поправете
        каде што треба (странски зборови и брендови) и отштиклирајте ги фирмите што треба да останат на латиница.</div>
      {rows.length === 0 ? <div className="callout good">Сите фирми се веќе на кирилица.</div> : (
        <form action={applyCyr} className="card">
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}><button className="btn pri">✓ Конвертирај ги штиклираните</button></div>
          <div className="tw">
            <table>
              <thead><tr><th></th><th>Сега</th><th>Назив (кирилица)</th><th>Адреса (кирилица)</th><th>Град (кирилица)</th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td><input type="checkbox" name="pick" value={f.id} defaultChecked style={{ width: 'auto' }} /></td>
                    <td className="mut" style={{ fontSize: 12 }}>{f.name}<br />{[f.address, f.city].filter(Boolean).join(', ')}</td>
                    <td><input name={`name.${f.id}`} defaultValue={kbdToCyr(f.name)} /></td>
                    <td><input name={`address.${f.id}`} defaultValue={kbdToCyr(f.address)} /></td>
                    <td><input name={`city.${f.id}`} defaultValue={kbdToCyr(f.city)} style={{ maxWidth: 160 }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}><button className="btn pri">✓ Конвертирај ги штиклираните</button></div>
        </form>
      )}
    </>
  );
}
