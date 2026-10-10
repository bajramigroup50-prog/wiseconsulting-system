/**
 * Архива на документи — legacy `VIEWS.arhiva` 6606 + patch 12783: every document of the firm with attached files
 * (`archRows`), filters (text, Вид, Од, До) in the working year, columns Датум · Вид · Број · Комитент · Износ ·
 * Налог · Документи, „Отвори“ / 🗑, „Листа (Excel)“, the scan / upload card with „🗂 Досие на фирмата“.
 * Server addition: PDF of the list.
 */
import Link from 'next/link';
import { can } from '@wise/core';
import { archFileLabel, archFilter, archKinds } from '@wise/core/office/archive';
import { requireUser } from '@/lib/auth';
import { archRows } from '@/lib/archive';
import { currentFirm, currentYear } from '@/lib/context';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { PdfButton } from '@/components/pdf-button';
import { RowAction } from '@/components/row-action';
import { arDel } from './actions';

type SP = { q?: string; kind?: string; from?: string; to?: string };

export default async function ArhivaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const firm = await currentFirm(u);
  if (!firm) return <><Hd t="Архива на документи" /><div className="callout">Изберете фирма со <b>⇄ Промени фирма</b>.</div></>;
  const year = await currentYear();
  const all = await archRows(firm.id);
  const f = { q: (sp.q ?? '').trim(), kind: sp.kind ?? '', from: sp.from ?? '', to: sp.to ?? '', year };
  const R = archFilter(all, f);
  const kinds = archKinds(all, year);
  const nf = R.reduce((a, r) => a + r.files.length, 0);
  const del = can(u.principal, 'del', firm.id);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])).toString();
  return (
    <>
      <Hd t="Архива на документи" sub={`${nf} датотеки · ${year}`}>
        <a className="btn" href={`/arhiva/xlsx?${qs}`}>Листа (Excel)</a>
        <PdfButton selector="#arList" title={`Архива на документи ${year}`} landscape />
      </Hd>
      {can(u.principal, 'write', firm.id) && (
        <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link className="btn pri" href="/arNewNav">📷 Скенирај / прикачи нов документ</Link>
          <span className="note" style={{ margin: 0 }}>Секој документ што ќе го архивирате (договор, решение, потврда, писмо, сертификат…) се зачувува во <b>досието на фирмата</b> по вид – со рок „Важи до“, праќање по Gmail / WhatsApp и преземање.</span>
          <span style={{ flex: 1 }} />
          <Link className="btn" href="/dosie">🗂 Досие на фирмата</Link>
        </div>
      )}
      <form className="card">
        <div className="row" style={{ gap: '10px 16px', alignItems: 'end' }}>
          <input name="q" placeholder="Барај број, комитент, име на датотека…" defaultValue={f.q} style={{ width: 280 }} />
          <label className="mini">Вид <select name="kind" defaultValue={f.kind} style={{ width: 'auto' }}><option value="">сите</option>{kinds.map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="mini">Од <input name="from" type="date" defaultValue={f.from} /></label>
          <label className="mini">До <input name="to" type="date" defaultValue={f.to} /></label>
          <button className="btn">Барај</button>
        </div>
      </form>
      {R.length ? (
        <div className="tw" id="arList">
          <table>
            <thead><tr><th>Датум</th><th>Вид</th><th>Број</th><th>Комитент</th><th className="n">Износ</th><th>Налог</th><th>Документи</th><th></th></tr></thead>
            <tbody>
              {R.map((r) => (
                <tr key={r.key}>
                  <td>{r.date ? dmy(r.date) : ''}</td><td>{r.kind}</td><td>{r.no}</td><td>{r.pn}</td>
                  <td className="n">{r.amt != null ? fmt(r.amt) : ''}</td>
                  <td>{r.nalog && <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(r.nalog)}`}>{r.nalog}</Link>}</td>
                  <td><div className="row" style={{ gap: 4 }}>{r.files.map((x) => <a key={x.id} className="btn sm" href={`/api/files/${x.id}`} target="_blank" rel="noopener" title={x.name}>{archFileLabel(x)}</a>)}</div></td>
                  <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    {r.href && <Link className="btn sm" href={r.href}>Отвори</Link>}
                    {r.archId && del && <RowAction action={arDel.bind(null, r.archId)} label="🗑" title="Избриши од архивата" confirm={`Да се избрише документот „${r.kind} ${r.no}“ од архивата?`} />}
                    {r.files.length === 1 && <a className="btn sm ghost" href={`/api/files/${r.files[0]!.id}?dl=1`} title="Преземи">⬇</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="card empty">Нема архивирани документи за избраните услови. Секој скениран или прикачен документ (фактура, фискална сметка, увозни документи, изводи) автоматски се чува тука.</div>}
      <p className="note">Документите се чуваат трајно во програмот, прикачени на фактурата или изводот. Кликнете на документот за преглед; од прегледот може да се отвори во нов прозорец или да се преземе.</p>
    </>
  );
}
