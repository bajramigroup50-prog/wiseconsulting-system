/** Legacy `VIEWS.paket` 8169 … **16838** — document package for a bank / institution, downloaded as one ZIP. */
import { and, asc, desc, eq } from 'drizzle-orm';
import { DOS_CAT, freshness } from '@wise/core/office';
import { docPackages, dossierDocs, mailLog, OFFICE_FILE_ENTITY } from '@wise/db';
import { db } from '@/lib/db';
import { filesOf, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { Hd, dmy, dmyHm } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { SendExtras } from '@/components/send-extras';
import { deletePackage, mailPackage, savePackage } from './actions';

/** Generated reports a package can hold (print views with the server „⬇ PDF“ button). */
const REPORTS: [string, string, string][] = [
  ['bba', '/print/bilanc?lvl=a', 'Бруто биланс (аналитика)'], ['bb3', '/print/bilanc?lvl=3', 'Бруто биланс (синтетика, 3 цифри)'],
  ['bs', '/pecati/bs-crm', 'Биланс на состојба (АОП)'], ['bu', '/pecati/bu-crm', 'Биланс на успех (АОП)'], ['db', '/pecati/db', 'Даночен биланс'],
  ['ddv', '/print/ddv04', 'ДДВ-04 пријави'], ['ddvk', '/print/ddvKnigi', 'Книга на влезни / излезни фактури (ДДВ)'],
];
/** Legacy `PKG_PRE` (+ 16580 „🏛 УЈП – еден клик“): reports and the newest dossier document of each listed kind. */
const PRE: Record<string, { n: string; rep: string[]; dos: string[] }> = {
  ujp: { n: '🏛 УЈП – еден клик', rep: ['bba', 'ddv', 'ddvk'], dos: [] },
  bank: { n: 'Банка – кредит', rep: ['bba', 'bs', 'bu', 'ddv'], dos: ['Тековна состојба (ЦРМ)', 'Тековна состојба – вистински сопственик (ЦРМ)', 'Решение за ДДВ / ЕДБ'] },
  lease: { n: 'Лизинг / тендер', rep: ['bb3', 'bs', 'bu', 'db'], dos: ['Тековна состојба (ЦРМ)', 'Тековна состојба – вистински сопственик (ЦРМ)'] },
  ddv: { n: 'ДДВ пријави', rep: ['ddv', 'ddvk'], dos: [] },
  pay: { n: 'Плати', rep: [], dos: [] },
};

export default async function PaketPage({ searchParams }: { searchParams: Promise<{ pre?: string; age?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { firm } = await officePage('paket', { perm: 'office' });
  if (!firm) return <NoFirm t="📦 Пакет документи" />;
  const td = today();
  const [D, P, sent] = await Promise.all([
    db().select().from(dossierDocs).where(eq(dossierDocs.firmId, firm.id)).orderBy(asc(dossierDocs.category), desc(dossierDocs.date)),
    db().select().from(docPackages).where(eq(docPackages.firmId, firm.id)).orderBy(desc(docPackages.createdAt)),
    db().select().from(mailLog).where(and(eq(mailLog.firmId, firm.id), eq(mailLog.entityType, 'doc_package'))).orderBy(desc(mailLog.createdAt)).limit(15),
  ]);
  const pre = sp.pre && PRE[sp.pre] ? PRE[sp.pre]! : null;
  const age = sp.age === '6' ? 6 : 3;
  const year = td.slice(0, 4);
  const from = sp.from || `${year}-01-01`, to = sp.to || td;
  const badPeriod = from > to;
  const preDos = new Set(pre ? pre.dos.map((c) => D.find((d) => d.category === c)?.id).filter((x): x is string => !!x) : []);
  const addM = (d: string, m: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };
  const oldFresh = D.filter((d) => preDos.has(d.id) && freshness(d, td) && td > addM(d.date ?? '1900-01-01', age));
  const F = await filesOf(OFFICE_FILE_ENTITY.dossier, D.map((d) => d.id));
  const order = (c: string) => (DOS_CAT as readonly string[]).indexOf(c);
  return (
    <>
      <Hd t="Пакет документи за банка / институција" sub={`${firm.name} · ${year}`}><a className="btn" href="/dosie">Документи на фирмата</a></Hd>
      <form className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <span className="mini">Брз избор:</span>
          {Object.entries(PRE).map(([k, x]) => <a key={k} className={`btn sm ${k === 'ujp' || sp.pre === k ? 'pri' : ''}`} href={`/paket?pre=${k}&age=${age}&from=${from}&to=${to}`}>{x.n}</a>)}
          <a className="btn sm ghost" href="/paket">Исчисти</a>
          <label className="mini">Период од <input name="from" type="date" defaultValue={from} /></label>
          <label className="mini">до <input name="to" type="date" defaultValue={to} /></label>
          <label className="mini">Тековна не постара од <select name="age" defaultValue={String(age)} style={{ width: 'auto' }}><option value="3">3 месеци</option><option value="6">6 месеци</option></select></label>
          {sp.pre && <input type="hidden" name="pre" value={sp.pre} />}
          <button className="btn sm">Примени</button>
        </div>
      </form>
      {badPeriod && <div className="callout bad">Периодот не е точен.</div>}
      {oldFresh.length > 0 && <div className="callout warn">{oldFresh.map((d) => <span key={d.id}>{d.category} од {dmy(d.date)} е постара од {age} месеци – извадете нова и скенирајте ја во Документи на фирмата.<br /></span>)}</div>}
      <ActionForm action={savePackage}>
        <h2>Нов пакет</h2>
        <div className="form">
          <label className="f">Назив<input name="name" required placeholder="на пр. Кредит – Стопанска банка" defaultValue={pre ? `${pre.n.replace(/^\S+ /, '')} – ${firm.name}` : ''} /></label>
          <label className="f">Примач (банка / институција)<input name="recipient" placeholder="на пр. Стопанска банка АД Скопје" /></label>
          <label className="f wide">Придружно писмо со листа на документи<textarea name="coverNote" rows={2} defaultValue={pre ? `Почитувани,\n\nВо прилог ги доставуваме бараните документи за ${firm.name} за периодот ${dmy(from)} – ${dmy(to)}.` : ''} /></label>
        </div>
        {D.length ? (
          <div className="tw"><table className="dense"><tbody>
            {[...D].sort((a, b) => order(a.category) - order(b.category)).map((d) => {
              const fr = freshness(d, td), n = F.get(d.id)?.length ?? 0;
              return (
                <tr key={d.id}>
                  <td><label className="chk"><input type="checkbox" name="dossierId" value={d.id} disabled={!n} defaultChecked={preDos.has(d.id)} /> <b>{d.title || d.category}</b></label></td>
                  <td className="mini">{d.category}</td><td>{dmy(d.date)} {fr && <Pill c={fr.lvl} title={fr.title}>{fr.text}</Pill>}</td>
                  <td>{n ? `📎 ${n}` : <span className="note">нема датотека</span>}</td>
                </tr>
              );
            })}
          </tbody></table></div>
        ) : <p className="note">Досието е празно – прво додадете документи во <a href="/dosie">Досие</a>.</p>}
        <p className="note">Генерираните извештаи (ДДВ-04, биланс на состојба / успех, даночен биланс) се додаваат во зачуван пакет подолу: „+ извештај“ го отвора печатењето, а „⬇ PDF“ таму го додава PDF-от во пакетот.</p>
        <div className="row"><button className="btn pri">📦 Подготви пакет</button></div>
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
            {REPORTS.map(([k, href, label]) => <a key={k} className={`btn sm ${pre?.rep.includes(k) ? 'pri' : ''}`} href={`${href}${href.includes('?') ? '&' : '?'}pkg=${p.id}&from=${from}&to=${to}`} target="_blank" rel="noopener">+ {label}</a>)}
          </div>
          {/* legacy `pkgMail` / `pkgMailGo` */}
          <ActionForm action={mailPackage} className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <input type="hidden" name="id" value={p.id} />
            <input name="to" type="email" placeholder="е-пошта на примачот" required style={{ width: 240 }} />
            <input name="subject" placeholder={`${p.name} – ${firm.name}`} style={{ width: 240 }} />
            <button className="btn sm">✉ Испрати по е-пошта</button>
            <textarea name="body" hidden defaultValue={p.coverNote ?? ''} />
            <SendExtras selName="__none" files={{}} defaultBody={p.coverNote ?? ''} />
          </ActionForm>
        </div>
      ))}
      {sent.length > 0 && (
        <>
          <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>Испратени пакети</h3>
          <div className="tw"><table className="dense">
            <thead><tr><th>Датум</th><th>Примач</th><th>Е-пошта</th><th>Пакет</th><th>Статус</th></tr></thead>
            <tbody>{sent.map((m) => <tr key={m.id}><td>{dmyHm(m.createdAt)}</td><td>{P.find((p) => p.id === m.entityId)?.recipient ?? ''}</td><td>{m.to.join(', ')}</td><td className="mini">{m.subject}</td><td><span className={`pill ${m.status === 'sent' ? 'good' : m.status === 'failed' ? 'bad' : ''}`}>{m.status}</span></td></tr>)}</tbody>
          </table></div>
        </>
      )}
      <p className="note">Пакетот може да се испрати по е-пошта (сите документи во прилог) или да се преземе како ZIP. Извештаите се додаваат во зачуван пакет: „+ извештај“ го отвора печатењето за избраниот период, а „⬇ PDF“ таму го додава PDF-от во пакетот.</p>
    </>
  );
}
