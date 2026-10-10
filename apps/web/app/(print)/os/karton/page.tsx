/** Legacy `osCardHTML` 8676 (`Karton_<invNo>.pdf`): КАРТОН НА ОСНОВНО СРЕДСТВО. */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { osQrText, type OsDoc } from '@wise/core/yearend/assets-io';
import { depreciationFor, fixedAssets } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Qr } from '@/components/qr';

export default async function OsCard({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const { firm, year } = await booksPage('os');
  if (!firm || !id) notFound();
  const [a] = await db().select().from(fixedAssets).where(and(eq(fixedAssets.firmId, firm.id), eq(fixedAssets.id, id))).limit(1);
  if (!a) notFound();
  const dep = (await depreciationFor(db(), firm.id, year)).rows.find((r) => r.id === a.id);
  const D = a.data as Record<string, string | undefined> & { docs?: OsDoc[] };
  const r = (l: string, v: React.ReactNode) => (v ? <tr><td style={{ width: '60mm' }}>{l}</td><td><b>{v}</b></td></tr> : null);
  return (
    <>
      <title>{`Karton_${a.invNo ?? ''}`}</title>
      <div className="ph"><div><div className="pt">КАРТОН НА ОСНОВНО СРЕДСТВО</div><div className="ps">{(a.invNo ?? '') + ' · ' + a.name}</div></div><div className="pm">{firm.name}<br />ЕДБ {firm.edb}</div></div>
      <div style={{ display: 'flex', gap: '6mm', alignItems: 'flex-start' }}>
        <table style={{ flex: 1 }}><tbody>
          {r('Инвентарен број', a.invNo)}{r('Назив', a.name)}{r('Сериски број / шасија', a.serial)}{r('Регистарска таблица', D.plate)}
          {r('Регистрација до', D.regExp ? dmy(D.regExp) : '')}{r('Осигурување до', D.insExp ? dmy(D.insExp) : '')}{r('Технички преглед до', D.techExp ? dmy(D.techExp) : '')}
          {r('Конто', a.konto)}{r('Во употреба од', dmy(a.date))}{r('Набавна вредност', fmt(a.cost))}{r('Стапка', Number(a.rate) + '%')}
          {r(`Акумулирана амортизација (${year})`, fmt(dep?.acc ?? 0))}{r('Сегашна вредност', fmt(Number(a.cost) - (dep?.acc ?? 0)))}
          {r('Добавувач / фактура', [a.supplier, a.invDoc].filter(Boolean).join(' · '))}{r('Локација / задолжено лице', a.location)}
        </tbody></table>
        <div style={{ textAlign: 'center' }}><Qr text={osQrText(a)} size="35mm" /><div style={{ font: '700 12pt monospace' }}>{a.invNo}</div></div>
      </div>
      {!!D.docs?.length && (
        <>
          <h2>Документи</h2>
          <table><thead><tr><th>Вид</th><th>Опис / број</th><th>Важи до</th></tr></thead>
            <tbody>{D.docs.map((x) => <tr key={x.fileId}><td>{x.type}</td><td>{x.title ?? ''}</td><td>{x.validTo ? dmy(x.validTo) : ''}</td></tr>)}</tbody></table>
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '18mm' }}><div>Составил<br /><br />______________________</div><div>Задолжено лице<br /><br />______________________</div></div>
    </>
  );
}
