/**
 * Legacy `VIEWS.opomeni` (13337 + patches 13404, 13429) — Неплатени фактури и опомени: issued invoices that are not
 * paid, grouped by customer; letters by e-mail, WhatsApp / Viber or PDF with late interest and costs (v401); the level
 * is suggested from the letters already sent.
 * Gap: legacy `opOnly` (open only the invoices ticked in Излез) and the „Картица“ shortcut.
 */
import Link from 'next/link';
import { can } from '@wise/core';
import { waPhone } from '@wise/core/firms/dunning';
import { officePage } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd, dmy } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { saveDunningSettings, sendDunningAll } from './actions';
import { letterFor, loadDunning } from './data';
import { GroupActions, WaAllRow } from './group-actions';

const LV = ['1. Опомена', '2. Опомена', 'Последна опомена пред тужба'];
const fc = (c: number) => (c / 100).toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function OpomeniPage({ searchParams }: { searchParams: Promise<{ all?: string; wa?: string }> }) {
  const { u, firm } = await officePage('opomeni');
  if (!firm) return <NoFirm t="Неплатени фактури и опомени" />;
  const sp = await searchParams;
  const all = sp.all === '1';
  const D = await loadDunning(firm);
  const write = can(u.principal, 'write', firm.id), settings = can(u.principal, 'settings', firm.id);
  const L = D.G.filter((g) => all || g.over > 0);
  const T = L.reduce((s, g) => s + g.over, 0), Tall = D.G.reduce((s, g) => s + g.open, 0);
  const N = D.G.flatMap((g) => g.rows).filter((r) => r.days <= 0);
  const withMail = D.G.filter((g) => g.over > 0 && D.pOf(g.pid).email).length;
  const q = (o: Record<string, string>) => '/opomeni?' + new URLSearchParams({ ...(all ? { all: '1' } : {}), ...o }).toString();
  const over = D.G.filter((g) => g.over > 0);
  const W = over.filter((g) => waPhone(D.pOf(g.pid).phone)), NW = over.filter((g) => !waPhone(D.pOf(g.pid).phone));
  return (
    <>
      <Hd t="Неплатени фактури и опомени" sub="излезни фактури што не се платени">
        <Link className="btn" href={all ? '/opomeni' : '/opomeni?all=1'}>{all ? 'Само достасани' : 'Прикажи ги и недостасаните'}</Link>
        <Link className="btn" href="/mailhist">📜 Историја на праќања</Link>
        {write && withMail > 0 && <RowAction className="btn pri" action={sendDunningAll} label={`✉ Испрати опомена на сите со е-пошта (${withMail})`} confirm={`Да се испрати опомена на ${withMail} купувачи со е-пошта?\n\n${over.filter((g) => D.pOf(g.pid).email).map((g) => '• ' + D.pOf(g.pid).name + ' – ' + fc(g.over) + ' (' + LV[g.lvlAuto] + ')').join('\n')}`} />}
        {write && <Link className="btn" href={q({ wa: 'all' })} style={{ borderColor: '#25D366' }}>💬 WhatsApp на сите</Link>}
      </Hd>
      <div className="tiles">
        <div className="tile"><span>Достасано, неплатено</span><b>{fc(T)}</b><i>{L.filter((g) => g.over > 0).length} купувачи</i></div>
        <div className="tile"><span>Вкупно отворено</span><b>{fc(Tall)}</b>{N.length > 0 && <i>од тоа {fc(N.reduce((s, r) => s + r.open, 0))} не е достасано ({N.length} ф-ри) · <Link href={all ? '/opomeni' : '/opomeni?all=1'}>{all ? 'скриј' : 'прикажи'}</Link></i>}</div>
        <div className="tile"><span>Рок кога фактурата нема рок</span><b>{Math.floor(Number(firm.settings && (firm.settings as { payDays?: unknown }).payDays) || 15)} дена</b></div>
        <div className="tile"><span>Затезна камата · трошоци</span><b>{D.rate ? String(D.rate).replace('.', ',') + '%' : 'без камата'}</b><i>{D.cost ? fc(D.cost) + ' ден. за опомена' : 'без трошоци'}</i></div>
      </div>
      {settings && (
        <details className="card">
          <summary><b>⚙ Рок, затезна камата и трошоци</b></summary>
          <ActionForm action={saveDunningSettings} className="" reset={false}>
            <div className="form">
              <label className="f">Рок на плаќање (дена) за фактурите без внесен рок<input name="payDays" inputMode="numeric" defaultValue={String((firm.settings as { payDays?: unknown }).payDays ?? 15)} /></label>
              <label className="f">Затезна камата – годишна стапка % (референтна стапка на НБРСМ + 8 п.п.). 0 = без камата<input name="opRate" inputMode="decimal" defaultValue={String(D.rate || '')} /></label>
              <label className="f">Трошоци за опомената (ден.). 0 = без трошоци<input name="opCost" inputMode="decimal" defaultValue={String(D.cost / 100 || '')} /></label>
            </div>
            <button className="btn pri">Зачувај</button>
          </ActionForm>
        </details>
      )}
      {sp.wa === 'all' && write && (
        <div className="card" style={{ borderColor: '#25D366' }}>
          <div className="hd"><b>💬 WhatsApp опомени – {W.length} купувачи со телефон</b><Link className="btn sm" href={q({})}>Затвори</Link></div>
          <p className="mini" style={{ margin: '0 0 8px' }}>WhatsApp не дозволува автоматско праќање од програма – за секој купувач кликнете „Отвори“, пораката е веќе напишана, во WhatsApp само притиснете „Испрати“. Потоа „✓“ за да се запамети.</p>
          <div className="tw"><table className="dense"><tbody>
            {W.map((g) => {
              const p = D.pOf(g.pid); const { X } = letterFor(D, g, g.lvlAuto);
              return (
                <tr key={g.pid}>
                  <td><b>{p.name}</b><div className="mini">{p.phone} · {LV[g.lvlAuto]}</div></td>
                  <td className="n">{fc(g.over)}</td>
                  <td><WaAllRow pid={g.pid} lvl={g.lvlAuto} href={`https://wa.me/${waPhone(p.phone)}?text=${encodeURIComponent(X.body)}`} viber={`viber://forward?text=${encodeURIComponent(X.body)}`} /></td>
                </tr>
              );
            })}
          </tbody></table></div>
          {NW.length > 0 && <p className="mini" style={{ marginTop: 8 }}>Без телефон ({NW.length}): {NW.map((g) => D.pOf(g.pid).name).join(', ')} – додајте телефон во Шифрарник → Комитенти.</p>}
        </div>
      )}
      {L.length ? L.map((g) => {
        const p = D.pOf(g.pid);
        const texts = [0, 1, 2].map((l) => { const { X } = letterFor(D, g, l); return { subj: X.subj, body: X.body }; });
        return (
          <div className="card" key={g.pid}>
            <div className="hd">
              <div><b>{p.name}</b> <span className="mini">{p.email || 'без е-пошта'} · {p.phone || 'без телефон'}</span></div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className={`pill ${g.over > 0 ? 'bad' : 'info'}`}>{g.over > 0 ? 'достасано ' + fc(g.over) : 'не е достасано'}</span>
                {g.last && <span className="pill">последна: {dmy(g.last.date)} · {LV[Math.min(2, g.last.level - 1)]} ({g.last.channel})</span>}
              </div>
            </div>
            <div className="tw"><table className="dense">
              <thead><tr><th>Фактура</th><th>Датум</th><th>Рок</th><th className="n">Износ</th><th className="n">Платено</th><th className="n">Должи</th><th className="n">Денови</th></tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.inv.id}>
                    <td>{r.inv.number}</td><td>{dmy(r.inv.date)}</td><td>{dmy(r.due)}</td>
                    <td className="n">{fc(r.inv.total)}</td><td className="n">{fc(r.inv.paid)}</td><td className="n"><b>{fc(r.open)}</b></td>
                    <td className="n" style={{ color: r.days > 30 ? 'var(--bad)' : r.days > 0 ? 'var(--warn)' : 'inherit' }}>{r.days > 0 ? r.days : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {g.over > 0 && <GroupActions pid={g.pid} lvlAuto={g.lvlAuto} email={p.email ?? ''} phone={waPhone(p.phone)} texts={texts} canMail={write} />}
          </div>
        );
      }) : <div className="card empty">✓ Нема достасани неплатени фактури.</div>}
    </>
  );
}
