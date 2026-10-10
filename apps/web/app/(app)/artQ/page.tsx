/**
 * Анализа и чистење на артикли — legacy `VIEWS.artQ` 11276 (+ one-click clean-up 11336), `artAnalyze`, `artMerge`,
 * `artUnitsGo`, `artAbbrSave/Prev/Go`, `artFmt`, `artIgn`, `artAutoGo`. Duplicate groups (same normalised name, code or
 * barcode), similar names, units, abbreviations and missing data; merging moves every reference to the master item.
 */
import Link from 'next/link';
import { Retail, stock } from '@wise/core';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { loadArtItems, settingsOf } from '@/lib/retail';
import { stockPage } from '@/lib/stock';
import { fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ActionForm } from '@/components/action-form';
import { artAbbrAction, artAutoAction, artFmtAction, artIgnoreAction, artMergeAction, artUnitsAction } from '../_retail/actions';

type SP = { t?: string; code?: string; pref?: string; prev?: string };
const TABS = ['dup', 'sim', 'unit', 'abbr', 'miss'] as const;

export default async function ArtQPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, L } = await stockPage('artQ');
  if (!firm || !L) return <NoFirm t="Анализа и чистење на артикли" />;
  const adm = canDo(u, 'del', firm.id), write = canDo(u, 'write', firm.id);
  const S = settingsOf(firm);
  const rules = Retail.artRules(S.artAbbr as Record<string, string>, S.artUnits as Record<string, string>);
  const F: Retail.ArtFilter = { code: sp.code === 'with' || sp.code === 'without' ? sp.code : 'all', pref: sp.pref ?? '' };
  const { items } = await loadArtItems(db(), firm.id);
  const qty = (id: string) => stock(L.ctx, id).qty;
  const R = Retail.artAnalyze(items, rules, { filter: F, ignore: (S.artIgnore as string[]) ?? [], stockOf: qty });
  const T = (TABS as readonly string[]).includes(sp.t ?? '') ? sp.t! : 'dup';
  const href = (p: Partial<SP>) => '/artQ?' + new URLSearchParams(Object.entries({ t: T, code: sp.code, pref: sp.pref, ...p }).filter(([, v]) => v) as [string, string][]).toString();
  const tabs: [string, string][] = [['dup', `Дупликати (${R.groups.length})`], ['sim', `Слични (${R.sim.length})`], ['unit', `Единици (${Object.keys(R.units).length})`], ['abbr', `Кратенки (${R.toks.length})`], ['miss', `Недостасува / грешки (${R.miss.length})`]];
  const row = (i: Retail.CleanItem & { price: number }) => {
    const s = i.type === 'service' ? null : qty(i.id);
    return <><td>{i.code}</td><td><b>{i.name}</b>{(i.aliases ?? []).length > 0 && <div className="mini">порано: {(i.aliases ?? []).slice(0, 3).join(', ')}</div>}</td><td>{i.unit}</td><td className="n">{s == null ? '—' : fq(s)}</td><td className="n">{fmt(i.price)}</td><td>{(i.barcodes ?? [])[0]}</td></>;
  };
  const prevList = T === 'abbr' && sp.prev ? R.I.map((i) => [i, Retail.artApplyAbbr(i.name, rules.abbr)] as const).filter(([i, n]) => n !== i.name) : [];

  return (
    <>
      <Hd t="Анализа и чистење на артикли" sub={`${R.I.length} артикли во филтерот`}><Link className="btn" href="/artikli">Производи и артикли</Link></Hd>
      <div className="callout">По увоз на лагер листата: споете ги дупликатите, изедначете ги единиците (кг/ком…), заменете ги кратенките и дополнете што недостасува. Правилата се памтат и следните увози веднаш ги препознаваат постојните артикли.</div>
      {adm && (
        <ActionForm action={artAutoAction} className="card" reset={false}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn pri">⚡ Среди сè со еден клик</button>
            <label className="chk" style={{ margin: 0 }}><input type="checkbox" name="sim" /> спои ги и сличните над 90%</label>
            <span className="mini">единици → имиња (кратенки, празни места) → спојување дупликати (главен: со шифра, па со повеќе движења)</span>
          </div>
        </ActionForm>
      )}
      <form className="card"><input type="hidden" name="t" value={T} /><div className="row" style={{ gap: '10px 18px', flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="mini">Шифра<select name="code" defaultValue={F.code} style={{ width: 'auto' }}><option value="all">сите артикли</option><option value="without">само без шифра</option><option value="with">само со шифра</option></select></label>
        <label className="mini">Шифри што почнуваат со / од–до<input name="pref" defaultValue={F.pref} placeholder="на пр. 10 или 1000-1999" style={{ width: 150 }} /></label>
        <button className="btn">Филтрирај</button>
        <span className="mini" style={{ flex: 1, minWidth: 220 }}>Шифрарникот е еден за целата фирма – што ќе се среди тука важи насекаде (големо и мало).</span>
      </div></form>
      <div className="row" style={{ gap: 6, margin: "6px 0 10px" }}>{tabs.map(([k, n]) => <Link key={k} className={`btn sm ${k === T ? "pri" : ""}`} href={href({ t: k, prev: undefined })}>{n}</Link>)}</div>

      {T === 'dup' && (R.groups.length ? R.groups.map((g, gi) => {
        const mi = Math.max(0, g.findIndex((i) => String(i.code ?? '').trim()));
        return (
          <ActionForm key={gi} action={artMergeAction} className="card">
            <input type="hidden" name="ids" value={g.map((i) => i.id).join(',')} />
            <div className="tw"><table className="dense">
              <thead><tr><th style={{ width: 70 }}>Главен</th><th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Залиха</th><th className="n">Цена</th><th>Баркод</th></tr></thead>
              <tbody>{g.map((i, ii) => <tr key={i.id}><td><input type="radio" name="master" value={i.id} defaultChecked={ii === mi} /></td>{row(i)}</tr>)}</tbody>
            </table></div>
            {adm && <div className="row" style={{ gap: 8, marginTop: 6 }}><button className="btn sm pri">⇢ Спои ги во избраниот</button><span className="mini">залихата, фактурите и движењата се префрлаат на главниот; другите имиња остануваат како „порано“ за препознавање при увоз</span></div>}
          </ActionForm>
        );
      }) : <div className="card empty">Нема дупликати (исто име по нормализација или ист баркод).</div>)}

      {T === 'sim' && (R.sim.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Артикл А</th><th>Артикл Б</th><th className="n">Сличност</th><th /></tr></thead>
          <tbody>{R.sim.map((x) => (
            <tr key={x.key}>
              <td>{x.a.name} <span className="mini">{x.a.unit} · зал. {fq(qty(x.a.id))}</span></td><td>{x.b.name} <span className="mini">{x.b.unit} · зал. {fq(qty(x.b.id))}</span></td>
              <td className="n">{Math.round(x.s * 100)}%</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {adm && <ActionForm action={artMergeAction} className="" style={{ display: 'inline' }}><input type="hidden" name="master" value={x.a.id} /><input type="hidden" name="ids" value={`${x.a.id},${x.b.id}`} /><button className="btn sm" title="Б оди во А">Б → А</button></ActionForm>}
                {adm && <ActionForm action={artMergeAction} className="" style={{ display: 'inline' }}><input type="hidden" name="master" value={x.b.id} /><input type="hidden" name="ids" value={`${x.a.id},${x.b.id}`} /><button className="btn sm" title="А оди во Б">А → Б</button></ActionForm>}
                {write && <RowAction action={artIgnoreAction.bind(null, x.key)} label="не се исти" />}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <div className="card empty">Нема слични имиња.</div>)}

      {T === 'unit' && (
        <ActionForm action={artUnitsAction} className="" reset={false}>
          <div className="tw"><table className="dense">
            <thead><tr><th>Единица (како е внесена)</th><th className="n">Артикли</th><th>Стандардна</th><th /></tr></thead>
            <tbody>{Object.entries(R.units).sort((a, b) => b[1] - a[1]).map(([un, n]) => {
              const s = Retail.artUnit(un, rules);
              return <tr key={un}><td><b>{un || '(празно)'}</b></td><td className="n">{n}</td><td><input name={'u_' + un} defaultValue={s !== un ? s : ''} placeholder={un ? 'остави' : 'на пр. ком'} style={{ width: 110 }} /></td><td>{s && s !== un ? <span className="pill warn">се менува</span> : null}</td></tr>;
            })}</tbody>
          </table></div>
          {write && <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn pri">Примени ги единиците на сите артикли</button><span className="mini">Пример: kg, кгр → кг; kom, бр → ком. Правилото се памети и важи и при следниот увоз.</span></div>}
        </ActionForm>
      )}

      {T === 'abbr' && (
        <>
          <div className="callout">Зборови со точка или кратки зборови во имињата. Внесете со што да се заменат – правилото се памети за фирмата, се применува на сите постојни артикли (со преглед) и при следните увози.</div>
          <ActionForm action={artAbbrAction} className="" reset={false}>
            <div className="tw"><table className="dense">
              <thead><tr><th>Кратенка</th><th className="n">Појавувања</th><th>Пример</th><th>Замени со</th></tr></thead>
              <tbody>{R.toks.map(([t, v]) => <tr key={t}><td><b>{t}</b></td><td className="n">{v.n}</td><td className="mini">{v.ex}</td><td><input name={'a_' + t} defaultValue={rules.abbr[t] ?? ''} style={{ width: 160 }} /></td></tr>)}</tbody>
            </table></div>
            {write && <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}><button className="btn">Зачувај ги правилата</button><Link className="btn pri" href={href({ prev: '1' })}>Преглед на промените на имињата</Link></div>}
          </ActionForm>
          {sp.prev && (prevList.length ? (
            <ActionForm action={artAbbrAction} className="card" reset={false}>
              <input type="hidden" name="apply" value="1" />
              {Object.entries(rules.abbr).map(([k, v]) => <input key={k} type="hidden" name={'a_' + k} value={v} />)}
              <b>{prevList.length} имиња ќе се сменат</b>
              <div className="tw" style={{ maxHeight: 320, overflow: 'auto' }}><table className="dense"><tbody>
                {prevList.map(([i, n]) => <tr key={i.id}><td><input type="checkbox" name={'r_' + i.id} defaultChecked /></td><td className="mini">{i.name}</td><td>→</td><td><b>{n}</b></td></tr>)}
              </tbody></table></div>
              <button className="btn pri">Примени ги избраните</button>
            </ActionForm>
          ) : <div className="callout">Нема имиња за промена (зачувајте ги правилата прво).</div>)}
        </>
      )}

      {T === 'miss' && (R.miss.length ? (
        <>
          <div className="tw"><table className="dense">
            <thead><tr><th>Шифра</th><th>Назив</th><th>Што треба да се среди</th><th /></tr></thead>
            <tbody>{R.miss.map((x) => <tr key={x.i.id}><td>{x.i.code}</td><td>{x.i.name}</td><td>{x.p.map((p) => <span key={p} className="pill warn" style={{ marginRight: 4 }}>{p}</span>)}</td><td>{write && <Link className="btn sm" href={`/artikli?edit=${x.i.id}`}>Измени</Link>}</td></tr>)}</tbody>
          </table></div>
          {write && <div className="row" style={{ gap: 8, marginTop: 8 }}><RowAction action={artFmtAction} label="Среди празни места и САМО ГОЛЕМИ БУКВИ кај сите" className="btn" confirm="Да се средат имињата (празни места, големи букви)?" /></div>}
        </>
      ) : <div className="card empty">Сите артикли имаат ДДВ, цена, единица и залихата не е во минус.</div>)}
    </>
  );
}
