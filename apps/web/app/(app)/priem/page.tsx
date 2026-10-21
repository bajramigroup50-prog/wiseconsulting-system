/**
 * 📥 Прием на документи: what a client brought, under a number of the office's деловодник (book 01, from 1 every
 * year for the whole office) – the dossier cover, the receipt for the client and the spine label to print, and
 * „↩ Вратено“ when the originals go back (ISO 9001 8.5.3, Уредба за канцелариско и архивско работење).
 */
import Link from 'next/link';
import { PRIEM_KINDS, PRIEM_KIND_NAME, priemNo, priemPeriodName, priemTotal } from '@wise/core/office/priem';
import { todaySkopje } from '@wise/core/office/dates';
import { receiptById, receiptList } from '@wise/db';
import { ActionForm, Submit } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { allowedFirms } from '@/lib/office';
import { priemReturned, priemSave } from './actions';

const T = '📥 Прием на документи';
const dt = (d: Date | null) => (d ? d.toLocaleString('mk-MK', { timeZone: 'Europe/Skopje', dateStyle: 'short', timeStyle: 'short' }) : '');
const prevMonth = (td: string) => { let y = +td.slice(0, 4), m = +td.slice(5, 7) - 1; if (!m) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };

export default async function PriemPage({ searchParams }: { searchParams: Promise<{ id?: string; all?: string; v?: string; per?: string; st?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const firm = await currentFirm(u);
  const td = todaySkopje();
  const year = Number(td.slice(0, 4));
  const all = sp.all === '1' || !firm;
  const F = all ? (await allowedFirms(u, { year: 'all' })).map((f) => f.id) : [firm!.id];
  const [L, sel] = await Promise.all([
    receiptList(db(), { firmIds: F, year }),
    sp.id && /^[0-9a-f-]{36}$/i.test(sp.id) ? receiptById(db(), sp.id) : Promise.resolve(null),
  ]);
  const S = sel && F.includes(sel.firmId) ? sel : null;
  const byClient = sp.v === 'klient';
  const qs = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const m = { all: all && firm ? '1' : undefined, v: sp.v, per: sp.per, st: sp.st, ...o };
    for (const [k, v] of Object.entries(m)) if (v) q.set(k, v);
    const x = q.toString();
    return '/priem' + (x ? '?' + x : '');
  };
  // filters: the period (month) and where the originals are
  const st = sp.st === 'kaj' || sp.st === 'vrateni' || sp.st === 'rok' ? sp.st : '';
  const per = sp.per && /^\d{4}-\d{2}$/.test(sp.per) ? sp.per : '';
  const LF = L.filter((r) => (!per || r.period === per) && (!st || (st === 'vrateni' ? !!r.returnedAt : st === 'rok' ? !r.returnedAt && !!r.returnDue && r.returnDue < td : !r.returnedAt)));
  const periods = [...new Set(L.map((r) => r.period))].sort().reverse();
  // 📁 by client → by month (the folders on the shelf)
  const groups = new Map<string, { name: string; months: Map<string, typeof LF> }>();
  for (const r of LF) {
    const g = groups.get(r.firmId) ?? { name: r.firmName, months: new Map() };
    g.months.set(r.period, [...(g.months.get(r.period) ?? []), r]);
    groups.set(r.firmId, g);
  }
  const G = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'mk'));
  return (
    <>
      <Hd t={T} sub={`Деловодник на канцеларијата · книга 01 – Примени · ${year}`} exp={false} />
      <div className="row noprint" style={{ gap: 8, marginBottom: 8 }}>
        {firm && <Link className={`btn sm ${all ? '' : 'pri'}`} href="/priem">{firm.name}</Link>}
        <Link className={`btn sm ${all ? 'pri' : ''}`} href="/priem?all=1">Сите фирми</Link>
        <span style={{ width: 12 }} />
        <Link className={`btn sm ${byClient ? '' : 'pri'}`} href={qs({ v: undefined })}>☰ Листа по број</Link>
        <Link className={`btn sm ${byClient ? 'pri' : ''}`} href={qs({ v: 'klient' })}>📁 По клиент и месец</Link>
      </div>

      {S && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Прием {priemNo(S.no, S.year)} · {S.firmName}</h3>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <a className="btn pri" href={`/print/priem?id=${S.id}&p=site`} target="_blank" rel="noreferrer">🖨 Печати сè</a>
              <a className="btn" href={`/print/priem?id=${S.id}&p=dosje`} target="_blank" rel="noreferrer">🗂 Насловна на досие</a>
              <a className="btn" href={`/print/priem?id=${S.id}&p=potvrda`} target="_blank" rel="noreferrer">🧾 Потврда за клиентот</a>
              <a className="btn" href={`/print/priem?id=${S.id}&p=etiketa`} target="_blank" rel="noreferrer">🏷 Етикета 4 cm</a>
              <a className="btn" href={`/print/priem?id=${S.id}&p=etiketa6`} target="_blank" rel="noreferrer">🏷 Етикета 6 cm</a>
            </div>
          </div>
          <p className="mini" style={{ margin: '6px 0' }}>Период <b>{priemPeriodName(S.period)}</b> · примено {dt(S.receivedAt)} · донесе {S.broughtBy || '—'} · прими {S.receivedByName || '—'} · се чува до {dmy(S.keepUntil)}</p>
          <p style={{ margin: '4px 0' }}>{S.items.map((i) => `${i.k === 'other' && i.text ? i.text : PRIEM_KIND_NAME[i.k]}: ${i.n}${i.pack ? ' пак.' : ''}`).join(' · ')} · <b>вкупно {priemTotal(S.items)}</b></p>
          {S.note && <p className="mini">{S.note}</p>}
          {S.returnedAt ? <span className="pill good">↩ Вратено {dt(S.returnedAt)}{S.returnedTo ? ' – ' + S.returnedTo : ''}</span> : (
            <ActionForm action={priemReturned.bind(null, S.id)} className="row" reset={false} style={{ gap: 8, alignItems: 'end', marginTop: 6 }}>
              <label className="f" style={{ margin: 0 }}>Оригиналите вратени на<input name="to" placeholder="име на лицето" /></label>
              <Submit className="btn">↩ Вратено</Submit>
              {S.returnDue && <span className="mini">рок за враќање: {dmy(S.returnDue)}</span>}
            </ActionForm>
          )}
        </div>
      )}

      {firm && !all && (
        <ActionForm action={priemSave} className="card" reset={false}>
          <h3 style={{ marginTop: 0 }}>+ Нов прием · {firm.name}</h3>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="f" style={{ margin: 0 }}>Период (месец)<input type="month" name="period" defaultValue={prevMonth(td)} required /></label>
            <label className="f" style={{ margin: 0 }}>Донесе (клиент)<input name="broughtBy" placeholder="име и презиме" /></label>
            <label className="f" style={{ margin: 0 }}>Оригиналите да се вратат до<input type="date" name="returnDue" /></label>
          </div>
          <div className="tw" style={{ marginTop: 10 }}><table className="dense" style={{ maxWidth: 640 }}>
            <thead><tr><th>Вид документ</th><th>Број</th><th>пакет</th></tr></thead>
            <tbody>{PRIEM_KINDS.map(([k, n]) => (
              <tr key={k}><td>{k === 'other' ? <input name="t_other" placeholder="Друго – опис" /> : n}</td>
                <td><input name={'n_' + k} type="number" min={0} max={9999} inputMode="numeric" style={{ width: 90 }} /></td>
                <td>{(k === 'fisk' || k === 'bank' || k === 'other') && <input type="checkbox" name={'p_' + k} title="бројот е пакети, не листови" />}</td></tr>
            ))}</tbody>
          </table></div>
          <label className="f" style={{ marginTop: 8 }}>Забелешка<input name="note" /></label>
          <Submit>📥 Прими и дај број</Submit>
          <p className="mini" style={{ marginBottom: 0 }}>Бројот го дава програмата (книга 01, од 1 секоја година за целата канцеларија) – потоа печатете ја насловната на досието и потврдата за клиентот.</p>
        </ActionForm>
      )}
      {!firm && <div className="callout">За нов прием изберете фирма горе. Подолу се сите приеми.</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Приеми {year}{all ? ' – сите фирми' : ''}</h3>
        <form method="get" className="row noprint" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 8 }}>
          {all && firm && <input type="hidden" name="all" value="1" />}
          {byClient && <input type="hidden" name="v" value="klient" />}
          <label className="f" style={{ margin: 0 }}>Период<select name="per" defaultValue={per}><option value="">сите</option>{periods.map((p) => <option key={p} value={p}>{priemPeriodName(p)}</option>)}</select></label>
          <label className="f" style={{ margin: 0 }}>Оригинали<select name="st" defaultValue={st}><option value="">сите</option><option value="kaj">кај нас</option><option value="rok">поминат рок за враќање</option><option value="vrateni">вратени</option></select></label>
          <button className="btn sm">Прикажи</button>
        </form>
        {byClient ? (G.length ? G.map((g) => (
          <details key={g.name} open={G.length <= 3} style={{ marginBottom: 6 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>📁 {g.name} <span className="mini">({[...g.months.values()].reduce((a, x) => a + x.length, 0)} приеми)</span></summary>
            <div style={{ paddingLeft: 18 }}>{[...g.months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([m, R]) => (
              <div key={m} style={{ margin: '4px 0' }}>🗂 <b>{priemPeriodName(m)}</b> · {R.map((r) => (
                <Link key={r.id} href={`/priem?id=${r.id}${all ? '&all=1' : ''}&v=klient`} style={{ marginRight: 10 }}>{priemNo(r.no, r.year)} ({priemTotal(r.items)} док.{r.returnedAt ? ', вратени' : ''})</Link>
              ))}</div>
            ))}</div>
          </details>
        )) : <div className="empty">Нема приеми.</div>) : LF.length ? <div className="tw"><table className="dense">
          <thead><tr><th>Арх. бр.</th><th>Примено</th>{all && <th>Фирма</th>}<th>Период</th><th>Содржина</th><th>Донесе / прими</th><th>Оригинали</th></tr></thead>
          <tbody>{LF.map((r) => (
            <tr key={r.id}><td><Link href={`/priem?id=${r.id}${all ? '&all=1' : ''}`}><b>{priemNo(r.no, r.year)}</b></Link></td><td>{dt(r.receivedAt)}</td>{all && <td>{r.firmName}</td>}
              <td>{priemPeriodName(r.period)}</td><td>{r.items.map((i) => `${PRIEM_KIND_NAME[i.k]} ${i.n}`).join(', ')}</td>
              <td>{r.broughtBy || '—'} / {r.receivedByName || '—'}</td>
              <td>{r.returnedAt ? <span className="pill good">вратени</span> : r.returnDue && r.returnDue < td ? <span className="pill bad">рок {dmy(r.returnDue)}</span> : r.returnDue ? <span className="pill warn">до {dmy(r.returnDue)}</span> : 'кај нас'}</td></tr>
          ))}</tbody>
        </table></div> : <div className="empty">Нема приеми{per || st ? ' за избраното' : ` во ${year}`}.</div>}
      </div>
    </>
  );
}
