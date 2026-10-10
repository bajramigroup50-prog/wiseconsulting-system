/**
 * Legacy `VIEWS.mpinIn` 14074 + v452 grid (`mpinGrid` 14136) + v453 manual entry / re-read — „МПИН од УЈП – прифатени
 * декларации, сите фирми одеднаш“. Upload all PDFs returned by УЈП; each is read (worker `mpin.read`), matched to its
 * firm by ЕДБ / name and, with one button, distributed: dossier → „Плати и персонал“, the payroll month marked
 * „✓ МПИН прифатен“, or — when the payroll was not calculated in the program — a journal from the declaration.
 */
import Link from 'next/link';
import { and, asc, eq, like } from 'drizzle-orm';
import { can } from '@wise/core';
import { MPIN_F, mpinPer, mpinReady, mpinWarnings, mpinWhat, type MpinRead, type MpinStat } from '@wise/core/law';
import { mpinAcks, mpinInbox, mpinPlanFor } from '@wise/db';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { allowedFirms, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { clearMpinList, deleteMpinMonth, editMpin, rereadMpin } from './actions';
import { MpinBook, MpinFirmSelect, MpinGo, MpinUpload } from './mpin-client';
import { PickFirm } from '../lawrep/pick-firm';

type Sp = { book?: string; q?: string; only?: string };

function state(stat: MpinStat, M: Partial<MpinRead> | null, firmId: string | null, error: string | null) {
  if (stat === 'queued') return <span className="note">⏳ чека</span>;
  if (stat === 'reading') return <span className="note">⏳ се чита…</span>;
  if (stat === 'error') return <span className="pill bad" title={error ?? ''}>Грешка</span>;
  if (stat === 'notm') return <span className="pill bad">Не е МПИН</span>;
  if (stat === 'done') return <span className="pill good">✓ Распоредено</span>;
  const w = mpinWarnings(M, firmId);
  return w.length ? <span className="pill warn">⚠ {w.join(' · ')}</span> : <span className="pill good">Подготвено</span>;
}

export default async function MpinInPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const { u } = await officePage('mpinIn', { perm: 'office' });
  const book = sp.book !== '0';
  const year = await currentYear();
  const F = await allowedFirms(u);
  const FW = F.filter((f) => can(u.principal, 'write', f.id));
  const fname = new Map(F.map((f) => [f.id, f.name]));
  const R = await db().select().from(mpinInbox).where(and(eq(mpinInbox.createdBy, u.id), eq(mpinInbox.cleared, false))).orderBy(asc(mpinInbox.createdAt));
  const rows = await Promise.all(R.map(async (r) => {
    const M = r.result as MpinRead | null;
    const firmId = r.firmId && fname.has(r.firmId) ? r.firmId : null;
    const stat = r.status as MpinStat;
    const plan = stat === 'ok' && firmId && M?.period && /^\d{4}-\d{2}$/.test(M.period) ? await mpinPlanFor(db(), firmId, M.period, book) : null;
    return { r, M, firmId, stat, plan, what: plan && M ? mpinWhat(M, plan) : null };
  }));
  const ready = rows.filter((x) => mpinReady({ stat: x.stat, firmId: x.firmId, M: x.M }));
  const corr = ready.filter((x) => x.plan?.old).length;
  const pending = rows.some((x) => x.stat === 'queued' || x.stat === 'reading');

  // grid by months (legacy mpinGrid)
  const Y = String(year);
  const idx = (await db().select().from(mpinAcks).where(and(like(mpinAcks.month, `${Y}-%`), eq(mpinAcks.replaced, false)))).filter((x) => fname.has(x.firmId));
  const q = (sp.q ?? '').toLowerCase(), only = sp.only === '1';
  const GF = F.filter((f) => (!q || f.name.toLowerCase().includes(q)) && (!only || idx.some((x) => x.firmId === f.id)));
  const MO = [...Array(12)].map((_, i) => `${Y}-${String(i + 1).padStart(2, '0')}`);
  const cur = today().slice(0, 7);

  return (
    <>
      <Hd t="📥 МПИН од УЈП – прифатени декларации" sub="сите фирми одеднаш"><Link className="btn" href="/plati">← Пресметка на плата</Link></Hd>
      <div className="card">
        <p className="note" style={{ marginTop: 0 }}>Прикачете ги сите вратени PDF од УЈП („Декларација за прием“) одеднаш. Програмата ја чита секоја: <b>ЕДБ и име на обврзникот → фирма</b>, период, бруто, придонеси, персонален данок, број за поднесување. Потоа со едно копче: PDF-от оди во <b>досие → Плати и персонал</b> на секоја фирма, месецот во „Пресметка на плата“ се означува <b>✓ МПИН прифатен</b>, а ако платата не е пресметана во програмот – <b>се отвара налог</b> (бруто / придонеси / данок / нето).</p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <MpinUpload pending={pending} />
          <MpinBook book={book} />
          {R.length > 0 && <RowAction className="btn ghost" action={clearMpinList} label="Исчисти листа" />}
        </div>
      </div>
      {rows.length ? (
        <>
          <div className="tw"><table className="dense">
            <thead><tr><th>Датотека</th><th>Обврзник (од МПИН)</th><th>Фирма во програмот</th><th>Период</th><th className="n">Бруто</th><th className="n">Придонеси + данок</th><th className="n">Нето</th><th>Состојба</th><th>Што ќе се направи</th></tr></thead>
            <tbody>
              {rows.map(({ r, M, firmId, stat, what }) => (
                <tr key={r.id}>
                  <td>{r.name}{M?.subNo && <div className="note">бр. {M.subNo}{M.subDate ? ' · ' + dmy(M.subDate) : ''}</div>}{M?.how && <div className="note">{M.how}</div>}</td>
                  <td>{M?.name ?? ''}<div className="note">{M?.edb ?? ''}</div></td>
                  <td>{stat === 'done' ? fname.get(r.firmId ?? '') ?? '' : <MpinFirmSelect id={r.id} value={firmId ?? ''} firms={FW.map((f) => ({ id: f.id, name: f.name }))} />}</td>
                  <td>{M?.period ? mpinPer(M.period) : ''}{M?.status && <div className="note">{M.status}</div>}</td>
                  <td className="n">{M?.gross ? fmt(M.gross) : ''}</td>
                  <td className="n">{M?.total ? fmt(M.total) : ''}</td>
                  <td className="n">{M?.gross ? fmt(M.net) : ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {state(stat, M, firmId, r.error)}
                    {['ok', 'notm', 'error'].includes(stat) && <> <RowAction action={rereadMpin.bind(null, r.id)} label="↻" title="Прочитај повторно" /></>}
                    {r.error && stat !== 'done' && <div className="note" style={{ color: 'var(--bad)', whiteSpace: 'normal' }}>{r.error}</div>}
                  </td>
                  <td style={{ maxWidth: 260, fontSize: 12 }}>
                    {stat === 'done' ? <>{r.res}{r.firmId && <div><PickFirm id={r.firmId} to="/nalozi" label={`→ Налози на ${fname.get(r.firmId) ?? ''}`} /></div>}</>
                      : what ? <>{what.corr && <><span style={{ color: 'var(--warn,#b26b00)' }}><b>Корекција:</b> {what.corr.replace(/^Корекција: /, '')}</span><br /></>}<span style={what.warn ? { color: 'var(--bad)' } : undefined}>{what.text}</span></> : null}
                    {['ok', 'notm', 'error'].includes(stat) && (
                      <details><summary className="mini">✎ Внеси / поправи рачно</summary>
                        <ActionForm action={editMpin} reset={false} className="form" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <input type="hidden" name="id" value={r.id} />
                          {MPIN_F.map(([k, n]) => {
                            const v = M?.[k];
                            const dv = k === 'period' && M?.period ? mpinPer(M.period) : (k === 'subDate' || k === 'due') && v ? dmy(String(v)) : v ?? '';
                            return <label key={k} className="f">{n}<input name={k} defaultValue={String(dv)} /></label>;
                          })}
                          <button className="btn sm pri">Зачувај</button>
                        </ActionForm>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <MpinGo ready={ready.length} corr={corr} book={book} />
        </>
      ) : <div className="empty">Сè уште нема прикачени МПИН.</div>}

      <div className="card" style={{ marginTop: 14 }}>
        <form className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>МПИН по месеци – {Y}</h2>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {!book && <input type="hidden" name="book" value="0" />}
            <input name="q" placeholder="Барај фирма…" defaultValue={sp.q ?? ''} style={{ width: 180 }} />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="only" value="1" defaultChecked={only} style={{ width: 'auto' }} /> само фирми со МПИН</label>
            <button className="btn sm">↻ Освежи</button>
          </div>
        </form>
        <p className="note">✓ = прифатен МПИН (📄 PDF, 🗑 бришење за корекција – само админ). „К“ = корекција. Жолто = поминат месец без МПИН.</p>
        <div className="tw"><table className="dense">
          <thead><tr><th>Фирма</th>{MO.map((m) => <th key={m} className="c">{m.slice(5)}</th>)}<th className="n">Вкупно бруто</th></tr></thead>
          <tbody>
            {GF.map((f) => (
              <tr key={f.id}>
                <td>{f.name}</td>
                {MO.map((mo) => {
                  const x = idx.find((y) => y.firmId === f.id && y.month === mo);
                  if (!x) return <td key={mo} className="c note" style={mo < cur ? { background: '#fff6e5' } : undefined}>{mo < cur ? '·' : ''}</td>;
                  const tip = `бр. ${x.no ?? ''}${x.date ? ' · ' + dmy(x.date) : ''} · бруто ${fmt(x.gross)} · придонеси+данок ${fmt(x.total)}${x.journalId ? ' · налог од МПИН' : x.runId ? ' · пресметка во програмот' : ''}${x.corr ? ' · КОРЕКЦИЈА' : ''}`;
                  return (
                    <td key={mo} className="c" style={{ whiteSpace: 'nowrap' }}>
                      <span className="pill good" title={tip}>✓{x.corr ? ' К' : ''}</span>
                      {x.fileId && <a className="btn sm ghost" style={{ padding: '0 4px' }} title="PDF" href={`/api/files/${x.fileId}`} target="_blank" rel="noopener">📄</a>}
                      {can(u.principal, 'del', f.id) && <RowAction style={{ padding: '0 4px' }} action={deleteMpinMonth.bind(null, f.id, mo)} label="🗑" title="Избриши (за да прикачите коригиран)"
                        confirm={`Да се избрише МПИН за ${mpinPer(mo)} – ${f.name}?\n\nСе брише: PDF во досие, ознаката „МПИН прифатен“${x.journalId ? ' и НАЛОГОТ од МПИН (книжењето)' : ''}.\nПотоа може да прикачите друг (коригиран) МПИН.`} />}
                    </td>
                  );
                })}
                <td className="n">{fmt(idx.filter((x) => x.firmId === f.id).reduce((s, x) => s + (+x.gross || 0), 0))}</td>
              </tr>
            ))}
            {!GF.length && <tr><td colSpan={14} className="note">Нема фирми.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
