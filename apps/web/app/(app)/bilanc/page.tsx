/**
 * Legacy `VIEWS.bilanc` 6665 (+ 12036, 13681) — Финансово › Бруто биланс; table = `bbTable` 6655. With the old desktop
 * program's „Бруто биланс – рекапитулар“: tabs Класи … Аналитики | Вкупно, parameters Префикс / Суфикс / Од – До конто /
 * Орг. ед., „Без колона ‚Само од тековна година‘“, Печатење (F2) / Landscape, Скратено печатење (F3) / Landscape,
 * Збирна аналитичка картица (F5), Excel; Enter / double click on a row opens „Аналитика“ (`/akart`) for that konto.
 */
import Link from 'next/link';
import { trialBalance } from '@wise/core';
import { effectiveChart } from '@wise/db';
import { booksPage, canDo, inYearOr, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { aggregatedLines } from '@/lib/ledger-agg';
import { BB_TABS, bbFilterLines, bbFilterOf, bbTab, bbView } from '@/lib/bb-filter';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ExportBar } from '@/components/parity-fin/export-bar';
import { ActionForm } from '@/components/action-form';
import { KeyNav } from '@/components/key-nav';
import { bbAnKOf } from '@/lib/parity-fin';
import { locationNames } from '../poobjekti/data';
import { saveBbAnKAction } from './actions';
import { BbTable } from './table';

type SP = { lvl?: string; from?: string; to?: string; q?: string; p?: string; close?: string; exp?: string; wh?: string; pre?: string; suf?: string; kf?: string; kt?: string; nocur?: string; cel?: string };

export default async function BilancPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('bilanc');
  if (!firm) return <NoFirm t="Бруто биланс" />;
  const tab = bbTab(sp.lvl);
  const from = inYearOr(sp.from, year, `${year}-01-01`), to = inYearOr(sp.to, year, `${year}-12-31`);
  const withClose = sp.close === '1', noCur = sp.nocur === '1', whole = sp.cel === '1';
  const flt = bbFilterOf(sp);
  const locs = await locationNames(firm.id);
  // legacy `bb_w` 6665: Објект / Орг. ед. filter when the firm has more than the main location
  const wh = sp.wh === 'none' || (sp.wh && locs.has(sp.wh)) ? sp.wh : '';
  const [lines, chart, P] = await Promise.all([aggregatedLines(firm.id, from, to, wh), effectiveChart(db(), firm.id), partnerOptions(firm.id)]);
  const names = new Map(chart.map((a) => [a.code, a.name]));
  const pname = new Map(P.map((p) => [p.id, p.name]));
  const pf = sp.p && pname.has(sp.p) ? sp.p : null;
  const q = (sp.q ?? '').trim();
  const V = bbView(lines, { tab, from, to, withClose, partnerId: pf, f: flt, q, accountName: (k) => names.get(k) });
  const T = V.total;
  const fl = bbFilterLines(lines, flt);
  const withPartners = new Set(fl.filter((l) => l.partnerId).map((l) => l.account));
  const state = { lvl: tab, from, to, q, p: pf ?? '', close: withClose ? '1' : '', wh, ...flt, nocur: noCur ? '1' : '', cel: whole ? '1' : '' };
  const enc = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
  const qs = (o: Partial<SP>) => '/bilanc?' + enc({ ...state, exp: sp.exp ?? '', ...o });
  const pr = (o: Record<string, string> = {}) => '/print/bilanc?' + enc({ ...state, ...o });
  const expRows = sp.exp && tab === 'a'
    ? trialBalance(fl, { level: 'a', from, to, withClose, partnerId: pf, byPartnerOf: sp.exp, partnerName: (id) => pname.get(id) }).rows : [];
  const zbir = '/print/kkart/zbir?' + enc({ from, to, ...flt, q: tab === 'a' ? q : '', p: pf ?? '' });
  const listed = tab === 'v' ? V.classes.map((c) => ({ k: c.c, name: 'Класа ' + c.c, ...c.total })) : V.rows;

  return (
    <>
      <KeyNav table="bb" keys={{ F2: pr({ or: 'p' }), F3: pr({ short: '1', or: 'p' }), F5: zbir }} />
      <Hd t="Бруто биланс" sub="рекапитулар" excel={false}>
        <a className="btn" href={pr({ or: 'p' })} target="_blank" rel="noopener" title={tab === 'a' ? 'Аналитики со комитенти' : undefined}>🖨 Печатење (F2)</a>
        <a className="btn" href={pr()} target="_blank" rel="noopener">Печатење Landscape</a>
        {tab === 'a' && <a className="btn" href={pr({ kom: '0' })} target="_blank" rel="noopener" title="Сите аналитички конта, без поделба по комитенти">🖨 Само конта (без комитенти)</a>}
        <a className="btn" href={pr({ short: '1', or: 'p' })} target="_blank" rel="noopener" title="Конто, назив, вкупно должи / побарува, салдо">Скратено печатење (F3)</a>
        <a className="btn" href={pr({ short: '1' })} target="_blank" rel="noopener">Скратено печатење Landscape</a>
        <a className="btn" href={zbir} target="_blank" rel="noopener" title="Аналитичките картици на сите конта од опсегот во едно печатење">Збирна аналитичка картица (F5)</a>
        <a className="btn" href="/print/bilanc/zl" target="_blank" rel="noopener" title="Аналитички бруто биланс за целата година пред заклучните книжења, со биланс на состојба и успех">Заклучен лист (PDF)</a>
        <ExportBar pdf={false} name={`Bruto_bilans_${year}`} title="Бруто биланс" rows={[['Конто', 'Назив', 'Салдо', 'Вк. должи', 'Вк. побарува', 'Поч. сост. должи', 'Поч. сост. побарува', ...(noCur ? [] : ['Должи од тек. година', 'Побарува од тек. година'])],
          ...listed.map((r) => [r.k, r.name, r.s, r.vd, r.vp, r.od, r.op, ...(noCur ? [] : [r.td, r.tp])])]} />
      </Hd>
      <div className="card">
        <div className="row" style={{ gap: 6 }}>
          {BB_TABS.map(([v, t]) => <Link key={v} className={`btn sm ${v === tab ? 'pri' : ''}`} href={qs({ lvl: v, exp: '' })}>{t}</Link>)}
        </div>
        <form className="row" style={{ gap: '8px 12px', alignItems: 'end', flexWrap: 'wrap' }}>
          <input type="hidden" name="lvl" value={tab} />
          <label className="f">Датум од<input type="date" name="from" defaultValue={from} /></label>
          <label className="f">до<input type="date" name="to" defaultValue={to} /></label>
          <label className="f" title="Само конта што почнуваат со">Префикс<input name="pre" defaultValue={flt.pre} inputMode="numeric" style={{ width: 80 }} /></label>
          <label className="f" title="Само конта што завршуваат со">Суфикс<input name="suf" defaultValue={flt.suf} inputMode="numeric" style={{ width: 70 }} /></label>
          <label className="f">Од конто<input name="kf" defaultValue={flt.kf} inputMode="numeric" style={{ width: 90 }} /></label>
          <label className="f">До конто<input name="kt" defaultValue={flt.kt} inputMode="numeric" style={{ width: 90 }} /></label>
          {locs.size > 0 && (
            <label className="f">Орг. ед. / објект
              <select name="wh" defaultValue={wh}><option value="">Сите</option>{[...locs].map(([id, n]) => <option key={id} value={id}>{n}</option>)}<option value="none">Без објект</option></select>
            </label>
          )}
          <label className="f">Конто / назив<input name="q" defaultValue={q} placeholder="на пр. 22 или добавувачи" style={{ width: 170 }} /></label>
          <label className="f">Комитент
            <select name="p" defaultValue={pf ?? ''} style={{ width: 200 }}>
              <option value="">сите комитенти</option>
              {P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="chk"><input type="checkbox" name="nocur" value="1" defaultChecked={noCur} /> Без колона „Само од тековна година“</label>
          <label className="chk"><input type="checkbox" name="close" value="1" defaultChecked={withClose} /> со налогот за затворање</label>
          <label className="chk" title="Износите заокружени на цели денари (завршната сметка / АОП-ите се секогаш во цели денари)"><input type="checkbox" name="cel" value="1" defaultChecked={whole} /> Без децимали</label>
          <button className="btn">Прикажи</button>
          {(flt.pre || flt.suf || flt.kf || flt.kt) && <Link className="btn sm" href={qs({ pre: '', suf: '', kf: '', kt: '', exp: '' })}>✕ параметри</Link>}
          {Math.abs(T.vd - T.vp) < 0.01 ? <span className="pill good">Должи = Побарува</span> : <span className="pill bad">Разлика {fmt(T.vd - T.vp)}</span>}
        </form>
      </div>
      {tab === 'a' && canDo(u, 'settings', firm.id) && (
        <ActionForm action={saveBbAnKAction} reset={false} className="row" style={{ gap: 8, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
          <span className="mini">Во PDF „Аналитики“ по комитенти се печатат контата што почнуваат со:</span>
          <input name="bbAnK" defaultValue={bbAnKOf(firm.settings).join(' ')} style={{ maxWidth: 260 }} />
          <button className="btn sm">Зачувај</button><span className="mini">(на пр. 0 1620 2620 1200 2200 7414)</span>
        </ActionForm>
      )}
      {sp.p && !pf && <div className="callout warn">Комитентот не е најден.</div>}
      {V.bbimpMixed && <div className="callout warn">Во периодот има и увезен бруто биланс и книжени документи – прометите може да се дуплираат. Проверете ја „Почетна состојба“.</div>}
      {V.classes.length ? (
        <>
          <div className="tw"><BbTable V={V} tab={tab} from={from} to={to} noCur={noCur} whole={whole} withPartners={withPartners} exp={sp.exp ?? ''} expRows={expRows} pf={pf}
            expHref={(k) => qs({ exp: k })} bbPartHref={(k) => `/bbPart?k=${k}&from=${from}&to=${to}${withClose ? '&close=1' : ''}${pf ? '&p=' + pf : ''}${wh ? '&wh=' + wh : ''}`} /></div>
          <p className="mini" style={{ marginTop: 6 }}>↑ ↓ избор · Enter / двоен клик = Аналитика на контото · F2 печатење · F3 скратено печатење · F5 збирна аналитичка картица</p>
        </>
      ) : <div className="card empty">Нема книжења за избраниот период{(flt.pre || flt.suf || flt.kf || flt.kt) ? ' и параметри' : ''}.</div>}
    </>
  );
}
