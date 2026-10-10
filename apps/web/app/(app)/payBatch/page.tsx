/**
 * Legacy `VIEWS.payBatch` (15316, v503–v510) — 👥 Плати – сите фирми: firms with pay-change notes are handled by hand;
 * for all others without changes the month is prepared as a preview (per employee: hours, gross, net) and posted only
 * after „✅ Потврди и прокнижи“; firms that bring payroll from Excel are not touched; MPIN for all firms in one zip.
 */
import Link from 'next/link';
import { can } from '@wise/core';
import { allowedFirms, officePage } from '@/lib/office';
import { notFound } from 'next/navigation';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { MK_MONTHS } from '@/lib/payroll/html';
import { deleteBatchRun, setPayManual } from './actions';
import { ConfirmForm } from './confirm-form';
import { PB_ST, pbScan, pbTot, type PbSt } from './data';

const f0 = (n: number) => Math.round(n || 0).toLocaleString('mk-MK');

export default async function PayBatchPage({ searchParams }: { searchParams: Promise<{ m?: string; mode?: string; go?: string }> }) {
  const { u } = await officePage('payBatch');
  if (u.role === 'klient') notFound();
  const sp = await searchParams;
  const now = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' }).slice(0, 7);
  const m = sp.m && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : now;
  const mode = sp.mode === 'cal' ? 'cal' : 'prev';
  const label = `${MK_MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
  const months = Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.UTC(+now.slice(0, 4), +now.slice(5, 7) - i, 1)); return d.toISOString().slice(0, 7); });
  const R = sp.go ? await pbScan(await allowedFirms(u), m, mode) : null;
  const vis = R?.filter((r) => r.st !== 'noemp') ?? [];
  const cnt = (k: PbSt) => R?.filter((r) => r.st === k).length ?? 0;
  const ready = vis.filter((r) => r.st === 'ready').length;
  const calc = vis.filter((r) => r.st === 'auto' || r.st === 'done').length;
  return (
    <>
      <Hd t="👥 Плати – сите фирми" sub="автоматски каде нема промени" />
      <form className="card">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f" style={{ margin: 0 }}>Месец<select name="m" defaultValue={m} style={{ width: 'auto' }}>{months.map((x) => <option key={x} value={x}>{MK_MONTHS[+x.slice(5) - 1]} {x.slice(0, 4)}</option>)}</select></label>
          <label className="f" style={{ margin: 0 }}>Основа за автоматската<select name="mode" defaultValue={mode} style={{ width: 'auto' }}>
            <option value="prev">Како претходниот месец (плати и задршки; часови по календар)</option><option value="cal">Стандардни часови по календар</option></select></label>
          <input type="hidden" name="go" value="1" />
          <button className="btn">🔍 Провери ги фирмите</button>
          {R && <a className={`btn${calc ? '' : ' disabled'}`} href={calc ? `/payBatch/mpin?m=${m}` : undefined} title="По еден МПИН фајл за секоја пресметана фирма, во еден zip">⬇ МПИН за сите ({calc})</a>}
        </div>
        <p className="note" style={{ margin: '8px 0 0' }}><b>Како работи:</b> фирмите со <b>⛔ известувања за промени</b> ги средувате рачно (Плата → известувањата → „✓ Внесено“). За сите други фирми без промени програмата прво прави <b>преглед</b> (👁 по вработени: часови, бруто, нето) – ништо не се книжи. Откако ќе проверите, со <b>„✅ Потврди и прокнижи“</b> се зачувуваат штиклираните. Фирмите без вработени не се пресметуваат. Фирмите што секој месец ги носат платите од <b>Excel</b> не се допираат. <b>Часовите</b> секогаш се според календарот на избраниот месец. Прекувремени, недела, празник и бонуси <b>не</b> се копираат – тие се внесуваат преку известување. Автоматската пресметка може да се избрише (🗑) и наместо неа да се увезе Excel.</p>
      </form>
      {!R && <div className="empty">Изберете месец и притиснете „🔍 Провери ги фирмите“.</div>}
      {R && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
            {(Object.keys(PB_ST) as PbSt[]).filter((k) => k !== 'noemp' && cnt(k)).map((k) => <span key={k} className={`pill ${PB_ST[k][1]}`}>{PB_ST[k][0]}: {cnt(k)}</span>)}
          </div>
          {!vis.length && <div className="callout warn">Нема фирми со вработени за овој месец. Внесете вработени кај фирмите (Плата → Матични податоци за вработени) – потоа „🔍 Провери ги фирмите“.</div>}
          {vis.length > 0 && (
            <ConfirmForm month={m} mode={mode} ready={ready} label={label}>
              <div className="card tw" style={{ overflow: 'auto' }}><table className="dense">
                <thead><tr><th>Фирма</th><th>Статус</th><th className="n">Вработени</th><th className="n">Бруто</th><th className="n">Нето</th><th>Известувања / забелешка</th><th /></tr></thead>
                <tbody>
                  {vis.map((r) => {
                    const [n, c] = PB_ST[r.st];
                    const del = (r.st === 'auto' || r.st === 'done') && can(u.principal, 'del', r.f.id) && !r.locked;
                    return (
                      <tr key={r.f.id}>
                        <td style={{ minWidth: 180 }}><b>{r.f.name}</b>
                          {r.preview && r.params && (
                            <details><summary className="mini">👁 Преглед по вработени</summary>
                              <table className="dense"><thead><tr><th>Вработен</th><th className="n">Основна нето</th><th className="n">Бруто</th><th className="n">Нето за исплата</th><th>Ставки</th></tr></thead>
                                <tbody>{r.preview.map((e, i) => { const t = pbTot([e], r.params!); return <tr key={i}><td>{e.name}</td><td className="n">{f0(Number(e.netBase))}</td><td className="n">{f0(t.g)}</td><td className="n"><b>{f0(t.n)}</b></td><td className="mini">{(e.lines ?? []).map((l) => l.type + (l.hours ? ' ' + l.hours + 'ч' : '')).join(' · ')}</td></tr>; })}</tbody></table>
                            </details>
                          )}
                        </td>
                        <td>{r.st === 'ready' ? <label className="chk" style={{ margin: 0 }}><input type="checkbox" name="fid" value={r.f.id} defaultChecked /> <span className={`pill ${c}`}>{n}</span></label> : <span className={`pill ${c}`}>{n}</span>}</td>
                        <td className="n">{r.tot ? r.tot.k : r.act || ''}</td><td className="n">{r.tot ? f0(r.tot.g) : ''}</td><td className="n">{r.tot ? f0(r.tot.n) : ''}</td>
                        <td className="mini">{r.st === 'notes' ? r.notes.map((x, i) => <div key={i}>• {x.type}{x.empName ? ' – ' + x.empName : ''}{x.text ? ': ' + x.text : ''}</div>)
                          : r.st === 'excel' ? 'Платата се носи од Excel – секој месец рачно.' : r.st === 'auto' ? 'Подготвена автоматски – проверете ја и испратете ги пресметките.' : r.st === 'lock' ? 'Отклучете го периодот кај „Фирми“.' : ''}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <Link className="btn sm" href={`/plati${r.st === 'auto' || r.st === 'done' ? '/' + m : ''}`} title="Изберете ја фирмата со ⇄ Промени фирма">Отвори</Link>
                          {(r.st === 'auto' || r.st === 'done') && <> <a className="btn sm ghost" href={`/payBatch/mpin?m=${m}&f=${r.f.id}`}>⬇ МПИН</a></>}
                          {del && <> <RowAction className="btn sm ghost danger" action={deleteBatchRun.bind(null, r.f.id, m)} label="🗑" title="Избриши ја пресметката (пр. за увоз од Excel)" confirm={`Да се избрише пресметката за ${m} на ${r.f.name} (заедно со налогот)?\n\nПотоа можете да ја увезете од Excel.`} /></>}
                          {r.st === 'ready' && <> <RowAction className="btn sm ghost" action={setPayManual.bind(null, r.f.id, true)} label="📥 Excel" title="Оваа фирма секој месец од Excel – не автоматски" /></>}
                          {r.st === 'excel' && <> <RowAction className="btn sm ghost" action={setPayManual.bind(null, r.f.id, false)} label="🤖 Автоматски" title="Вклучи автоматско" /></>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </ConfirmForm>
          )}
          {R.length - vis.length > 0 && <p className="mini">{R.length - vis.length} фирми без вработени – за нив не се пресметува плата.</p>}
        </>
      )}
    </>
  );
}
