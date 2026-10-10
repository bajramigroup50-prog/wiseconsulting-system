/**
 * Акции и попусти — legacy `VIEWS.m_akcii` 5802, `akEditor`, `akcSave`, `akStart`, `akEnd`, `akDel`, `akDocHTML`.
 * 1) decision (name, period, items, regular and promotional price) · 2) at the start a price-reduction levelling on the
 * counted stock · 3) at the end a levelling back to the regular prices. Prints: decision, calculation, price-back.
 */
import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { priceAt, promotionCostFloor, promotionPrice, stockAt } from '@wise/core';
import { levellingDocs, promotions } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ActionForm } from '@/components/action-form';
import { PrintButton } from '@/components/stock-ui';
import { deletePromoAction, runPromoAction, savePromoAction } from '../_retail/actions';

type SP = { nov?: string; id?: string; wh?: string; from?: string; to?: string; name?: string; pct?: string; rnd?: string; q?: string; view?: string; k?: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (x: number) => Math.round(x * 100) / 100;

export default async function AkciiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('m_akcii');
  if (!firm || !L) return <NoFirm t="Акции и попусти" />;
  const write = canDo(u, 'akcSave', firm.id);
  const stores = L.locations.filter((l) => l.kind === 'store');
  if (!stores.length) return <><Hd t="Акции и попусти" /><div className="card empty">Прво додајте продавница во шифрарникот.</div></>;
  const today = todayIso();
  const all = await db().select().from(promotions).where(eq(promotions.firmId, firm.id)).orderBy(desc(promotions.dateFrom));
  const its = new Map((L.ctx.items ?? []).map((i) => [i.id, i]));

  const view = sp.view ? all.find((a) => a.id === sp.view) : undefined;
  if (view) {
    const k = sp.k === 'kalk' || sp.k === 'end' ? sp.k : 'odl';
    const nivId = k === 'kalk' ? view.levellingStartId : k === 'end' ? view.levellingEndId : null;
    const [niv] = nivId ? await db().select().from(levellingDocs).where(and(eq(levellingDocs.firmId, firm.id), inArray(levellingDocs.id, [nivId]))).limit(1) : [];
    const rate = (id: string) => Number(its.get(id)?.rate ?? 18);
    let ta = 0, tv = 0;
    return (
      <>
        <Hd t={'Акција ' + view.number}><Link className="btn" href="/m_akcii">← Назад</Link><PrintButton /></Hd>
        <div className="printarea pdfdoc" style={{ background: '#fff', padding: 12 }}>
          {k === 'odl' ? <>
            <div className="ph"><div><div className="pt">ОДЛУКА ЗА АКЦИСКА ПРОДАЖБА бр. {view.number}</div><div className="ps">{firm.name}</div></div></div>
            <p>Врз основа на Законот за трговија и интерните акти на {firm.name}, се донесува одлука за акциска продажба (намалување на цени):</p>
            <p><b>Назив на акцијата:</b> {view.name}<br /><b>Продажен објект:</b> {L.locName(view.locationId)}<br /><b>Период:</b> од {dmy(view.dateFrom)} до {dmy(view.dateTo)} година</p>
            <table><thead><tr><th>Р.б.</th><th>Шифра</th><th>Назив</th><th>ЕМ</th><th className="n">Редовна цена со ДДВ</th><th className="n">Попуст %</th><th className="n">Акциска цена со ДДВ</th></tr></thead>
              <tbody>{view.lines.map((l, i) => { const it = its.get(l.itemId); return <tr key={i}><td>{i + 1}</td><td>{it?.code}</td><td>{it?.name}</td><td>{it?.unit}</td><td className="n">{fmt(l.old)}</td><td className="n">{fq(r2((1 - l.new / (l.old || 1)) * 100))}</td><td className="n">{fmt(l.new)}</td></tr>; })}</tbody></table>
            <p>Цените на стоките на акција се истакнуваат со редовната и акциската цена и со периодот на траење на акцијата. По завршувањето на акцијата се враќаат редовните цени со нивелација.</p>
            <div className="grid2" style={{ marginTop: 40 }}><div>{dmy(view.date)}</div><div style={{ textAlign: 'right' }}>Управител<br /><br />____________________</div></div>
          </> : !niv ? <p>Нема документ.</p> : <>
            <div className="ph"><div><div className="pt">{k === 'kalk' ? 'КАЛКУЛАЦИЈА ЗА НАМАЛУВАЊЕ НА ЦЕНИ (АКЦИЈА)' : 'НИВЕЛАЦИЈА – ВРАЌАЊЕ НА РЕДОВНИ ЦЕНИ'} бр. {niv.number}</div><div className="ps">{firm.name} · {L.locName(view.locationId)} · {dmy(niv.date)}</div></div></div>
            <p>Акција: <b>{view.name}</b> ({dmy(view.dateFrom)} – {dmy(view.dateTo)}) · Одлука бр. {view.number}</p>
            <table><thead><tr><th>Р.б.</th><th>Шифра</th><th>Назив</th><th>ЕМ</th><th className="n">Пописана количина</th><th className="n">Стара цена</th><th className="n">Нова цена</th><th className="n">Разлика по ед.</th><th className="n">Вкупна разлика</th><th className="n">од тоа ДДВ</th></tr></thead>
              <tbody>{niv.lines.map((l, i) => {
                const it = its.get(l.itemId); const dd = r2(l.qty * (l.new - l.old)); const v = r2((dd * rate(l.itemId)) / (100 + rate(l.itemId))); ta += dd; tv += v;
                return <tr key={i}><td>{i + 1}</td><td>{it?.code}</td><td>{it?.name}</td><td>{it?.unit}</td><td className="n">{fq(l.qty)}</td><td className="n">{fmt(l.old)}</td><td className="n">{fmt(l.new)}</td><td className="n">{fmt(r2(l.new - l.old))}</td><td className="n">{fmt(dd)}</td><td className="n">{fmt(v)}</td></tr>;
              })}</tbody>
              <tfoot><tr className="tot"><td colSpan={8}>Вкупно</td><td className="n">{fmt(r2(ta))}</td><td className="n">{fmt(r2(tv))}</td></tr></tfoot></table>
            <div className="grid2" style={{ marginTop: 40 }}><div>Пописна комисија:<br /><br />1. ____________________<br /><br />2. ____________________</div><div style={{ textAlign: 'right' }}>Одговорно лице<br /><br />____________________</div></div>
          </>}
        </div>
      </>
    );
  }

  const edit = sp.id ? all.find((a) => a.id === sp.id && a.status === 'plan') : undefined;
  if (write && (sp.nov !== undefined || edit)) {
    const wh = stores.some((s) => s.id === sp.wh) ? sp.wh! : edit?.locationId ?? stores[0]!.id;
    const from = sp.from && ISO.test(sp.from) ? sp.from : edit?.dateFrom ?? today;
    const to = sp.to && ISO.test(sp.to) ? sp.to : edit?.dateTo ?? from;
    const pct = sp.pct ?? (edit?.pct != null ? String(Number(edit.pct)) : '');
    const rnd = sp.rnd ?? String(edit?.rounding ?? 0);
    const name = sp.name ?? edit?.name ?? '';
    const sel = new Map((edit?.lines ?? []).map((l) => [l.itemId, l.new]));
    const q = (sp.q ?? '').toLowerCase().trim();
    const cand = (L.ctx.items ?? []).filter((it) => it.type === 'goods' || it.type === 'product')
      .map((it) => ({ it, s: stockAt(L.ctx, { item: it.id, wh, date: from }).qty, old: priceAt(L.ctx, it, wh, from) }))
      .filter((r) => Math.abs(r.s) > 1e-9 || sel.has(r.it.id))
      .filter((r) => !q || `${r.it.code ?? ''} ${r.it.name ?? ''}`.toLowerCase().includes(q));
    const base = `/m_akcii?${edit ? 'id=' + edit.id : 'nov'}`;
    return (
      <>
        <Hd t="Акција / попуст" sub={edit ? 'измена · ' + edit.number : 'нова акција'}><Link className="btn" href="/m_akcii">Откажи</Link></Hd>
        <form className="card">
          {edit ? <input type="hidden" name="id" value={edit.id} /> : <input type="hidden" name="nov" value="" />}
          <div className="form">
            <label className="f wide">Назив на акцијата<input name="name" defaultValue={name} placeholder="на пр. Есенска акција -20%" /></label>
            <label className="f">Продавница<select name="wh" defaultValue={wh}>{stores.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label className="f">Од<input name="from" type="date" defaultValue={from} /></label><label className="f">До<input name="to" type="date" defaultValue={to} /></label>
            <label className="f">Попуст % (за сите избрани)<input name="pct" inputMode="decimal" defaultValue={pct} /></label>
            <label className="f">Заокружи новата цена<select name="rnd" defaultValue={rnd}><option value="0">без заокружување</option><option value="1">на цел денар</option><option value="10">на 10 денари</option></select></label>
            <label className="f">Барај<input name="q" defaultValue={sp.q ?? ''} placeholder="🔍 Шифра или назив…" /></label>
          </div>
          <div className="row"><button className="btn">Освежи листата (продавница, датум, попуст)</button><span className="note">Се нудат артиклите со залиха на денот „Од“.</span></div>
        </form>
        <ActionForm action={savePromoAction} className="card" reset={false}>
          {[['id', edit?.id ?? ''], ['name', name], ['wh', wh], ['from', from], ['to', to], ['pct', pct], ['rnd', rnd]].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="tw"><table className="dense">
            <thead><tr><th /><th>Шифра</th><th>Артикл</th><th className="n">Залиха</th><th className="n">Редовна МПЦ</th><th className="n">Попуст %</th><th className="n">Акциска МПЦ</th><th className="n">Набавна со ДДВ</th></tr></thead>
            <tbody>{cand.map((r) => {
              const nw = promotionPrice(r.old, sel.has(r.it.id) ? { price: sel.get(r.it.id) } : {}, { pct, rnd });
              const nab = promotionCostFloor(L.ctx, r.it, wh);
              return (
                <tr key={r.it.id}>
                  <td><input type="checkbox" name={'s_' + r.it.id} defaultChecked={sel.has(r.it.id)} /></td><td>{r.it.code}</td><td>{r.it.name}</td><td className="n">{fq(r.s)}</td><td className="n">{fmt(r.old)}</td>
                  <td className="n"><input name={'p_' + r.it.id} inputMode="decimal" placeholder={pct} style={{ width: 70, textAlign: 'right' }} /></td>
                  <td className="n"><input name={'n_' + r.it.id} inputMode="decimal" defaultValue={sel.has(r.it.id) ? String(sel.get(r.it.id)) : ''} placeholder={String(nw)} style={{ width: 100, textAlign: 'right' }} /></td>
                  <td className="n">{fmt(nab)}{nw < nab && <> <span className="pill bad" title="Новата цена е под набавната">под набавна</span></>}</td>
                </tr>
              );
            })}{!cand.length && <tr><td colSpan={8} className="empty">Нема артикли со залиха во продавницата.</td></tr>}</tbody>
          </table></div>
          <p className="note">Попустот за сите се задава горе; за поединечен артикл може да внесете свој % или директно акциска цена.</p>
          <div className="row"><span style={{ flex: 1 }} /><Link className="btn" href={base}>Ресетирај</Link><button className="btn pri">Зачувај одлука</button></div>
        </ActionForm>
      </>
    );
  }

  const L1 = all.filter((a) => a.dateFrom.startsWith(String(year)) || a.dateTo.startsWith(String(year)));
  const st = (a: (typeof all)[number]): [string, string] => a.status === 'done' ? ['Завршена', ''] : a.status === 'active' ? (today > a.dateTo ? ['Истечена – вратете цени', 'warn'] : ['Активна', 'good']) : (today >= a.dateFrom ? ['Треба да започне', 'warn'] : ['Планирана', 'info']);
  const due = L1.filter((a) => (a.status === 'plan' && today >= a.dateFrom) || (a.status === 'active' && today > a.dateTo));
  return (
    <>
      <Hd t="Акции и попусти" sub="акциска продажба со калкулација за намалување на цени">{write && <Link className="btn pri" href="/m_akcii?nov">+ Нова акција</Link>}</Hd>
      {due.length > 0 && <div className="callout warn">{due.map((a) => <div key={a.id}>{a.status === 'active'
        ? <>Акцијата <b>{a.name}</b> заврши на {dmy(a.dateTo)} – вратете ги редовните цени (нивелација). {write && <RowAction action={runPromoAction.bind(null, a.id, true)} className="btn sm pri" label="Заврши и врати цени" confirm={`Да се вратат редовните цени со нивелација?`} />}</>
        : <>Акцијата <b>{a.name}</b> почнува {dmy(a.dateFrom)} – направете ја калкулацијата за намалување. {write && <RowAction action={runPromoAction.bind(null, a.id, false)} className="btn sm pri" label="Започни акција" confirm="Да се направи калкулација за намалување на цени? Количините се од залихата на тој ден." />}</>}</div>)}</div>}
      <div className="card"><p className="note" style={{ marginTop: 0 }}>Постапка: 1) <b>Одлука</b> за акциска продажба (назив, период, артикли, стара и нова цена) · 2) на почетокот <b>Калкулација за намалување на цени</b> (нивелација по пописана залиха) · 3) на крајот <b>нивелација за враќање</b> на редовните цени. Разликите влегуваат во ЕТМ и во книжењето (разлика во цена и ДДВ).</p>
        {L1.length ? <div className="tw"><table>
          <thead><tr><th>Бр.</th><th>Акција</th><th>Продавница</th><th>Период</th><th className="n">Артикли</th><th className="n">Просечен попуст</th><th>Статус</th><th /></tr></thead>
          <tbody>{L1.map((a) => {
            const s = st(a);
            const avg = a.lines.length ? Math.round(a.lines.reduce((x, l) => x + (1 - l.new / (l.old || 1)) * 100, 0) / a.lines.length) : 0;
            return (
              <tr key={a.id}><td>{a.number}</td><td><b>{a.name}</b></td><td>{L.locName(a.locationId)}</td><td>{dmy(a.dateFrom)} – {dmy(a.dateTo)}</td><td className="n">{a.lines.length}</td><td className="n">{avg}%</td><td><span className={'pill ' + s[1]}>{s[0]}</span></td>
                <td><div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                  {a.status === 'plan' && write && <><Link className="btn sm" href={`/m_akcii?id=${a.id}`}>Измени</Link><RowAction action={runPromoAction.bind(null, a.id, false)} className="btn sm pri" label="Започни" confirm="Да се направи калкулација за намалување на цени? Количините се од залихата на тој ден." /></>}
                  {a.status === 'active' && write && <RowAction action={runPromoAction.bind(null, a.id, true)} className="btn sm" label="Заврши" confirm="Да се вратат редовните цени со нивелација?" />}
                  <Link className="btn sm" href={`/m_akcii?view=${a.id}&k=odl`}>Одлука</Link>
                  {a.levellingStartId && <Link className="btn sm" href={`/m_akcii?view=${a.id}&k=kalk`}>Калкулација</Link>}
                  {a.levellingEndId && <Link className="btn sm" href={`/m_akcii?view=${a.id}&k=end`}>Враќање</Link>}
                  {a.status === 'plan' && write && <RowAction action={deletePromoAction.bind(null, a.id)} label="🗑" style={{ color: 'var(--bad)' }} confirm={`Да се избрише одлуката ${a.number}?`} />}
                </div></td></tr>
            );
          })}</tbody></table></div> : <div className="empty">Нема акции. Креирајте со „+ Нова акција“.</div>}
      </div>
    </>
  );
}
