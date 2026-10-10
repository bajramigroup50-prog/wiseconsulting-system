/** Legacy `VIEWS.paket` 8169 … **16838** — document package for a bank / institution, downloaded as one ZIP. */
import { asc, desc, eq } from 'drizzle-orm';
import { DOS_CAT, freshness } from '@wise/core/office';
import { docPackages, dossierDocs, OFFICE_FILE_ENTITY } from '@wise/db';
import { db } from '@/lib/db';
import { filesOf, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { Hd, dmy, dmyHm } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deletePackage, mailPackage, savePackage } from './actions';

/** Generated reports a package can hold (print views with the server „⬇ PDF“ button). */
const REPORTS: [string, string][] = [
  ['/print/ddv04', 'ДДВ-04'], ['/pecati/bs-crm', 'Биланс на состојба'], ['/pecati/bu-crm', 'Биланс на успех'], ['/pecati/db', 'Даночен биланс'],
  ['/print/bilanc?lvl=a', 'Бруто биланс (аналитика)'], ['/print/bilanc?lvl=3', 'Бруто биланс (синтетика, 3 цифри)'],
];

export default async function PaketPage() {
  const { firm } = await officePage('paket', { perm: 'office' });
  if (!firm) return <NoFirm t="📦 Пакет документи" />;
  const td = today();
  const [D, P] = await Promise.all([
    db().select().from(dossierDocs).where(eq(dossierDocs.firmId, firm.id)).orderBy(asc(dossierDocs.category), desc(dossierDocs.date)),
    db().select().from(docPackages).where(eq(docPackages.firmId, firm.id)).orderBy(desc(docPackages.createdAt)),
  ]);
  const F = await filesOf(OFFICE_FILE_ENTITY.dossier, D.map((d) => d.id));
  const order = (c: string) => (DOS_CAT as readonly string[]).indexOf(c);
  return (
    <>
      <Hd t="📦 Пакет документи за банка / институција" sub={firm.name} />
      <ActionForm action={savePackage}>
        <h2>Нов пакет</h2>
        <div className="form">
          <label className="f">Назив<input name="name" required placeholder="на пр. Кредит – Стопанска банка" /></label>
          <label className="f">До (банка / институција)<input name="recipient" /></label>
          <label className="f wide">Пропратна белешка<textarea name="coverNote" rows={2} /></label>
        </div>
        {D.length ? (
          <div className="tw"><table className="dense"><tbody>
            {[...D].sort((a, b) => order(a.category) - order(b.category)).map((d) => {
              const fr = freshness(d, td), n = F.get(d.id)?.length ?? 0;
              return (
                <tr key={d.id}>
                  <td><label className="chk"><input type="checkbox" name="dossierId" value={d.id} disabled={!n} /> <b>{d.title || d.category}</b></label></td>
                  <td className="mini">{d.category}</td><td>{dmy(d.date)} {fr && <Pill c={fr.lvl} title={fr.title}>{fr.text}</Pill>}</td>
                  <td>{n ? `📎 ${n}` : <span className="note">нема датотека</span>}</td>
                </tr>
              );
            })}
          </tbody></table></div>
        ) : <p className="note">Досието е празно – прво додадете документи во <a href="/dosie">Досие</a>.</p>}
        <p className="note">Генерираните извештаи (ДДВ-04, биланс на состојба / успех, даночен биланс) се додаваат во зачуван пакет подолу: „+ извештај“ го отвора печатењето, а „⬇ PDF“ таму го додава PDF-от во пакетот.</p>
        <div className="row"><button className="btn pri">Зачувај пакет</button></div>
      </ActionForm>

      {P.map((p) => (
        <div key={p.id} className="card">
          <div className="hd"><h2 style={{ fontSize: 15 }}>{p.name}{p.recipient && <span className="mk"> · {p.recipient}</span>}</h2>
            <div className="row">
              <a className="btn sm pri" href={`/api/office/pkg/${p.id}`}>⬇ ZIP</a>
              <RowAction action={deletePackage.bind(null, p.id)} label="✕" confirm="Да се избрише пакетот?" />
            </div></div>
          <ol style={{ margin: 0 }}>{p.items.map((i, k) => <li key={k}>{i.label}</li>)}</ol>
          <span className="mini">{dmyHm(p.createdAt)}</span>
          {/* legacy PKG_REP: generated reports, rendered by `pdf.render` and added to this package (`?pkg=`) */}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {REPORTS.map(([href, label]) => <a key={href} className="btn sm" href={`${href}${href.includes('?') ? '&' : '?'}pkg=${p.id}`} target="_blank" rel="noopener">+ {label}</a>)}
          </div>
          {/* legacy `pkgMail` / `pkgMailGo` */}
          <ActionForm action={mailPackage} className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <input type="hidden" name="id" value={p.id} />
            <input name="to" type="email" placeholder="е-пошта на примачот" required style={{ width: 240 }} />
            <input name="subject" placeholder={`${p.name} – ${firm.name}`} style={{ width: 240 }} />
            <button className="btn sm">✉ Испрати по е-пошта</button>
          </ActionForm>
        </div>
      ))}
    </>
  );
}
