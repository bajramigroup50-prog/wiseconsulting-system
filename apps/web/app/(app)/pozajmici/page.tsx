/**
 * Legacy `VIEWS.pozajmici` 16720 (+ v541–v545 patches 16854–16880) — Финансово › 🤝 Позајмици и заеми (договори):
 * contracts for given / received loans, disbursements and repayments found on loan kontos (033 / 160–163 given,
 * 260–263 / 285 received, or a „заем / позајм“ konto name) in bank statements, cash and journals, repayments applied
 * FIFO per partner, interest to date, overdue / unsigned, „без договор“ list with bulk creation. `?ed=new|<id>` editor,
 * `?mv=<move id>` prefill from a disbursement.
 */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { LOAN_KONTO, nextLoanNo } from '@wise/core/finance';
import { partners, type Loan } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { today } from '@/lib/finance';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { attachSignedAction, createLoansAction, deleteLoanAction, ignoreMoveAction, linkMoveAction, rebookLoansAction, saveLoanAction } from './actions';
import { UploadField } from '@/components/upload-field';
import { SelectAll } from './select-all';
import { LoanContract } from './contract';
import { lnIgnored, loanData } from './data';

type SP = { ed?: string; dir?: string; mv?: string };

export default async function PozajmiciPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('pozajmici');
  if (!firm) return <NoFirm t="🤝 Позајмици и заеми" />;
  const [D, P] = await Promise.all([loanData(firm, year), db().select().from(partners).where(eq(partners.firmId, firm.id)).orderBy(asc(partners.name))]);
  const pm = new Map(P.map((p) => [p.id, p]));
  const write = canDo(u, 'lnSave', firm.id);
  const td = today();

  if (sp.ed && write) {
    const ex = sp.ed !== 'new' ? D.loans.find((l) => l.id === sp.ed) : undefined;
    const mv = sp.mv ? D.flows.find((r) => r.id === sp.mv) : undefined;
    const dir = ex?.dir ?? mv?.dir ?? (sp.dir === 'received' ? 'received' : 'given');
    const E: Loan = ex ?? {
      id: '', firmId: firm.id, dir, partnerId: mv?.partnerId || null, partnerName: null, number: nextLoanNo(D.loans.map((l) => ({ no: l.number, date: l.date })), (mv?.date ?? td).slice(0, 4)),
      date: mv?.date ?? td, amount: mv ? mv.amt.toFixed(2) : '', rate: '0', termDate: mv ? mv.date.slice(0, 4) + '-12-31' : null, installments: 1, purpose: null, cash: false, signed: false,
      konto: mv?.konto ?? LOAN_KONTO[dir], moveIds: mv ? [mv.id] : [], auto: false, createdBy: null, createdAt: new Date(), updatedAt: new Date(),
    };
    const B = D.flows.filter((r) => r.kind === 'out' && r.dir === E.dir && (!E.partnerId || r.partnerId === E.partnerId));
    return (
      <>
        <Hd t={(ex ? 'Договор за позајмица ' : 'Нов договор за позајмица ') + (E.number ?? '')} sub={E.dir === 'given' ? '📤 фирмата дава позајмица' : '📥 фирмата прима позајмица'}>
          <Link className="btn" href="/pozajmici">← Листа</Link>
          {ex && <a className="btn" href={`/print/fin/pozajmica?id=${ex.id}`} target="_blank" rel="noopener">PDF</a>}
          {ex && <a className="btn" href={`/pozajmici/word?id=${ex.id}`}>Word</a>}
        </Hd>
        {ex && (
          <ActionForm action={attachSignedAction} reset={false}>
            <input type="hidden" name="id" value={ex.id} />
            <div className="row" style={{ gap: 8, alignItems: 'end' }}>
              <UploadField firmId={firm.id} label="📎 Прикачи го потпишаниот договор (скен)" accept="application/pdf,image/*" />
              <button className="btn">Зачувај прилог</button>
              {(D.fileOf.get(ex.id) ?? []).map((f, i) => <a key={f} className="btn sm" href={`/api/files/${f}`} target="_blank" rel="noopener">📎 {i + 1}</a>)}
            </div>
          </ActionForm>
        )}
        <ActionForm action={saveLoanAction} reset={false}>
          <input type="hidden" name="id" value={ex?.id ?? ''} />
          <div className="form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>
            <label className="f">Вид<select name="dir" defaultValue={E.dir}><option value="given">Дадена позајмица (фирмата е заемодавач)</option><option value="received">Примена позајмица (фирмата е заемопримач)</option></select></label>
            <label className="f">Комитент<select name="partnerId" defaultValue={E.partnerId ?? ''} required><option value="">— изберете —</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="f">Број<input name="number" defaultValue={E.number ?? ''} /></label>
            <label className="f">Датум<input name="date" type="date" defaultValue={E.date} required /></label>
            <label className="f">Износ (ден.)<input name="amount" type="number" step="0.01" defaultValue={E.amount} required /></label>
            <label className="f">Конто<input name="konto" defaultValue={E.konto ?? ''} title="1620 = дадени позајмици (побарување), 2620 = примени позајмици (обврска)" /></label>
            <label className="f">Камата % годишно (0 = без камата)<input name="rate" type="number" step="0.01" defaultValue={Number(E.rate)} /></label>
            <label className="f">Рок за враќање<input name="termDate" type="date" defaultValue={E.termDate ?? ''} /></label>
            <label className="f">Број на рати (1 = еднократно)<input name="installments" type="number" min={1} defaultValue={E.installments} /></label>
            <label className="f" style={{ gridColumn: '1/-1' }}>Намена (по избор)<input name="purpose" defaultValue={E.purpose ?? ''} placeholder="на пр. за обртни средства" /></label>
          </div>
          <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
            <label className="chk"><input type="checkbox" name="cash" value="1" defaultChecked={E.cash} /> Во готово (не преку сметка)</label>
            <label className="chk"><input type="checkbox" name="signed" value="1" defaultChecked={E.signed} /> Договорот е потпишан од двете страни</label>
          </div>
          {B.length > 0 && (
            <div style={{ marginTop: 10 }}><b style={{ fontSize: 13 }}>Исплати (изводи, благајна, налози) за овој договор:</b>
              {B.map((r) => (
                <label key={r.id} className="chk" style={{ display: 'block', margin: '3px 0' }}>
                  <input type="checkbox" name="mv" value={r.id} defaultChecked={E.moveIds.includes(r.id)} /> {dmy(r.date)} · {pm.get(r.partnerId)?.name ?? ''} · <b>{fmt(r.amt)}</b> · <span className="mini">{r.src} · {r.desc.slice(0, 60)}</span>
                </label>
              ))}
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn pri">Зачувај</button></div>
        </ActionForm>
        <div className="card"><div className="pdfwrap"><div className="pdfdoc" style={{ margin: '0 auto' }}><LoanContract l={E} firm={firm} partner={E.partnerId ? pm.get(E.partnerId) : undefined} /></div></div></div>
      </>
    );
  }

  const open = D.rows.filter((r) => r.bal > 0.5);
  const tG = open.filter((r) => r.l.dir === 'given').reduce((s, r) => s + r.bal, 0), tR = open.filter((r) => r.l.dir === 'received').reduce((s, r) => s + r.bal, 0);
  const ign = lnIgnored(firm);
  const ignRows = D.flows.filter((r) => ign.has(r.id));
  const rows = [...D.rows].sort((a, c) => String(c.l.date).localeCompare(String(a.l.date)));
  return (
    <>
      <Hd t="🤝 Позајмици и заеми" sub="дадени и примени · договор за секоја позајмица">
        {write && <Link className="btn pri" href="/pozajmici?ed=new&dir=given">+ Дадена позајмица</Link>}
        {write && <Link className="btn pri" href="/pozajmici?ed=new&dir=received">+ Примена позајмица</Link>}
      </Hd>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
        {([['📤 Дадени – отворено', fmt(tG)], ['📥 Примени – отворено', fmt(tR)], ['⛔ Исплати без договор', String(D.unlinked.length)], ['⚠ Задоцнети / непотпишани', String(D.rows.filter((r) => r.over || r.noSig).length)]] as const).map(([t, n]) => (
          <div key={t} className="card" style={{ flex: 1, minWidth: 180, margin: 0 }}><div className="muted" style={{ fontSize: 12.5 }}>{t}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{n}</div></div>
        ))}
      </div>
      {D.misK.length > 0 && (
        <div className="callout warn" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>🔧 <b>{D.misK.length}</b> позајмици од изводите се прокнижени на други конта (не на 1620 / 2620): {D.misK.slice(0, 5).map((m) => `${dmy(m.date)} ${fmt(m.amt)}`).join(', ')}{D.misK.length > 5 ? '…' : ''}</span>
          <span style={{ flex: 1 }} />
          {write && <RowAction className="btn pri" label="🔧 Прекнижи на 1620/2620" action={rebookLoansAction} confirm={`Да се прекнижат ${D.misK.length} ставки од изводите на 1620 (дадени) / 2620 (примени) позајмици?`} />}
        </div>
      )}
      {D.unlinked.length > 0 && (
        <ActionForm action={createLoansAction} reset={false} style={{ borderColor: 'var(--bad)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: '0 0 6px' }}>⛔ Позајмици без договор (изводи, налози, благајна)</h2>
            <span className="row" style={{ gap: 6 }}>{write && <SelectAll name="mv" />}{write && <button className="btn sm pri">📝 Креирај договори за означените</button>}</span>
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: '0 0 6px' }}>Инспекцијата бара договор за секоја позајмица. Програмот ги најде на контата за заеми. Означете ги и креирајте договори (непотпишани), или отворете поединечно.</p>
          <table className="dense"><thead><tr><th /><th>Датум</th><th>Вид</th><th>Комитент</th><th>Опис</th><th className="n">Износ</th><th /></tr></thead>
            <tbody>{D.unlinked.map((r) => (
              <tr key={r.id}>
                <td><input type="checkbox" name="mv" value={r.id} /></td>
                <td>{dmy(r.date)}<div className="mini">{r.src}</div></td><td>{r.dir === 'given' ? '📤 дадена' : '📥 примена'}</td>
                <td>{pm.get(r.partnerId)?.name ?? '—'}</td><td className="mini">{r.desc.slice(0, 70)}</td><td className="n">{fmt(r.amt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{write && <>
                  <Link className="btn sm pri" href={`/pozajmici?ed=new&mv=${encodeURIComponent(r.id)}`}>📝 Направи договор</Link>{' '}
                  {D.loans.some((l) => l.dir === r.dir && l.partnerId === r.partnerId) && <><RowAction label="🔗 Поврзи" title="Поврзи ја со последниот договор на комитентот" action={linkMoveAction.bind(null, r.id)} confirm="Да се поврзе исплатата со последниот договор на овој комитент?" />{' '}</>}
                  <RowAction label="↩ Не е позајмица" title="Ова е враќање / не е позајмица – да не се бара договор" action={ignoreMoveAction.bind(null, r.id, false)} />
                </>}</td>
              </tr>
            ))}</tbody></table>
        </ActionForm>
      )}
      <div className="card tw"><table className="dense">
        <thead><tr><th>Бр.</th><th>Вид</th><th>Комитент</th><th>Датум</th><th className="n">Износ</th><th className="n">Вратено</th><th className="n">Останува</th><th>Камата</th><th>Рок</th><th>Договор</th><th /></tr></thead>
        <tbody>{rows.length ? rows.map((r) => {
          const l = r.l;
          return (
            <tr key={l.id}>
              <td>{l.number}</td><td>{l.dir === 'given' ? '📤 дадена' : '📥 примена'}{l.auto && <> <span className="pill" title="Креиран автоматски">авто</span></>}</td>
              <td>{l.partnerId ? pm.get(l.partnerId)?.name ?? '—' : <><span className="pill warn">без комитент</span> {l.partnerName}</>}</td>
              <td>{dmy(l.date)}</td><td className="n">{fmt(l.amount)}</td><td className="n">{fmt(r.rep)}</td><td className="n"><b>{fmt(r.bal)}</b></td>
              <td>{l.rate ? `${l.rate}%${r.int ? ' · ' + fmt(r.int) : ''}` : 'без камата'}</td>
              <td>{r.over ? <span className="pill bad">задоцнет {dmy(l.termDate)}</span> : l.termDate ? dmy(l.termDate) : '—'}</td>
              <td>{l.signed ? <span className="pill good">✓ потпишан</span> : <span className="pill warn">непотпишан</span>}{(D.fileOf.get(l.id) ?? []).map((f) => <a key={f} href={`/api/files/${f}`} target="_blank" rel="noopener" title="Потпишан договор"> 📎</a>)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {write && <Link className="btn sm" href={`/pozajmici?ed=${l.id}`}>✎</Link>}{' '}
                <a className="btn sm" href={`/print/fin/pozajmica?id=${l.id}`} target="_blank" rel="noopener">PDF</a>{' '}
                <a className="btn sm" href={`/pozajmici/word?id=${l.id}`}>Word</a>
                {canDo(u, 'del', firm.id) && <RowAction label="🗑" title="Избриши" confirm={`Да се избрише договорот ${l.number ?? ''}?`} action={deleteLoanAction.bind(null, l.id)} />}
              </td>
            </tr>
          );
        }) : <tr><td colSpan={11} className="muted">Нема внесени договори за позајмица.</td></tr>}</tbody>
      </table></div>
      {ignRows.length > 0 && (
        <details className="card"><summary className="mini">↩ {ignRows.length} ставки означени како враќање / не е позајмица</summary>
          <table className="dense" style={{ marginTop: 6 }}><tbody>{ignRows.map((x) => (
            <tr key={x.id}><td>{dmy(x.date)}</td><td>{pm.get(x.partnerId)?.name ?? ''}</td><td className="n">{fmt(x.amt)}</td>
              <td>{write && <RowAction label="Врати во листата" action={ignoreMoveAction.bind(null, x.id, true)} />}</td></tr>
          ))}</tbody></table>
        </details>
      )}
      <p className="note">Ист образец за дадена и за примена позајмица – страните се менуваат (Заемодавач / Заемопримач). Враќањата се препознаваат по комитент на контата за заеми. Дадени позајмици на физички лица / сопственици невратени до 31.12 се додаваат во даночната основа (ЗДД чл. 11); бескаматна позајмица на сопственик / поврзано лице може да се смета за скриена распределба на добивка (ЗДД чл. 9 т. 7). Камата исплатена на физичко лице – персонален данок 10% (е-ППД).</p>
    </>
  );
}
