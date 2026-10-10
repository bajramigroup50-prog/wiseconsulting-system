/** Legacy `VIEWS.zsRok` (10523) — Што, каде и кога се поднесува (year-end filing calendar per entity type). */
import Link from 'next/link';
import { YE_ENTITY_NAMES } from '@wise/core';
import { zsRokRows } from '@wise/core/firms/zsrok';
import { firmEntity } from '@wise/db';
import { booksPage } from '@/lib/books';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

export default async function ZsRokPage() {
  const { firm, year } = await booksPage('zsRok');
  if (!firm) return <NoFirm t="Што, каде и кога се поднесува" />;
  const e = firmEntity(firm);
  const R = zsRokRows(e, year);
  return (
    <>
      <Hd t="Што, каде и кога се поднесува" sub={YE_ENTITY_NAMES[e]} />
      <div className="tw"><table>
        <thead><tr><th>Што</th><th>Каде</th><th>Рок</th><th></th></tr></thead>
        <tbody>
          {R.map(([a, b, c, v]) => (
            <tr key={a}><td><b>{a}</b></td><td>{b}</td><td>{c}</td><td>{v && <Link className="btn sm" href={`/${v}`}>Отвори</Link>}</td></tr>
          ))}
        </tbody>
      </table></div>
      <div className="callout">ℹ Редослед: <b>прво УЈП</b> (е-Даноци), <b>потоа ЦРМ</b> (e-submit) – два поднесоци со исти износи. Ако податоците во двата не се совпаѓаат, ЦРМ бара повторно поднесување. Кога рокот паѓа во неработен ден, се поместува на првиот работен ден; УЈП понекогаш го продолжува рокот – следете ги нивните соопштенија.</div>
      <p className="note">Видот на субјектот се менува во „🧩 Модули по дејност“. Извори: ЦРМ – информации за поднесување годишна сметка; УЈП – обрасци ДБ, ДБ-ВП, ДБ-НП/ВП, ДЛД-ДБ; Закон за сметководството на непрофитните организации (чл. 17–19).</p>
    </>
  );
}
