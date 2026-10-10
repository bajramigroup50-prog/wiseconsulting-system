/**
 * 📠 Фискални извештаи (рачна каса) — legacy `VIEWS.fiskPer` (final 13151): manual entry of daily / periodic fiscal
 * reports (`fkManual` 13048), posting with the fiscal scheme (`fkPost` 13101 → `fiskEntries`), goods issue for the
 * turnover with FIFO / LIFO / proportional selection (`fkIssuePlan` 11407, `fkIssue` 11454) and the daily fiscal
 * report control (`dfiHTML` 13131 → `dfiControl` 11479).
 * Reading a fiscal report from a photo / PDF (legacy `fkRead`, `FISK_PROMPT`) runs in the worker (`FiskScan`) and
 * prefills `FiskEditor` (`?ai=<id>`).
 */
import Link from 'next/link';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { FISCAL_SCHEMES, dfiControl, fkIssuePlan, type FkMethod } from '@wise/core';
import { loadLedgerLines, loadStockSales, salesDaily } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dateInYear, locOptions, pickLoc, rangeOf, stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteSalesDayAction } from '../_stock/actions';
import { FiskEditor, type FiskDraft } from '../_stock/editors';
import { fiskAfterRead, fiskEditorRows, fiskFinish, type FiskEditorRow, type FiskRead } from '@wise/core/ai/fisk';
import { loadAiResult } from '@/lib/ai';
import { FiskScan } from './fisk-scan';
import { FiskRead as FiskReadPanel, type ReadRow } from './fisk-read';
import { DfiSettings, DeviceForm } from './fisk-forms';
import { deleteDeviceAction, type FiskDevice } from './actions';
import { fkRows } from '@wise/core/ai/fisk';
import { fkCheck } from '@wise/core/fisk-parity';
import { posBalance } from '@wise/db';

type SP = {
  ai?: string; r?: string; tab?: string; d?: string; wh?: string; meth?: string; g18?: string; g10?: string; g5?: string; g0?: string; from?: string; to?: string;
  /** Draft fields carried by the „Предложи стока“ link. */
  n?: string; sc?: string; t?: string; c?: string; f?: string; tt?: string; note?: string; rev?: string; ck?: string; cash?: string; dev?: string; nv?: string;
};

export default async function FiskPerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('fiskPer');
  if (!firm || !L) return <NoFirm t="Фискални извештаи" />;
  const write = canDo(u, 'fkPost', firm.id);
  const tab = sp.tab === 'dfi' ? 'dfi' : sp.tab === 'dev' ? 'dev' : 'list';
  const locs = locOptions(L);
  const O = L.settings.fiskOpt;
  const wh = pickLoc(L, sp.wh) || O.wh || locs.find((l) => l.kind === 'store')?.id || 'main';
  const date = dateInYear(sp.d, year);
  const nonVat = !L.settings.vatRegistered;
  const meth = (['fifo', 'lifo', 'prop'].includes(sp.meth ?? '') ? sp.meth : O.meth || 'fifo') as 'fifo' | 'lifo' | 'prop';
  const gross: Record<string, string> = {};
  for (const r of ['18', '10', '5', '0']) { const v = sp[('g' + r) as 'g18']; if (v) gross[r] = v; }
  let plan: { itemId: string; label: string; qty: number; price: number; rate: number }[] | null = null;
  if (Object.keys(gross).length) {
    const G: Record<string, number> = { 18: 18, 10: 10, 5: 5, 0: 0 };
    const g = Object.fromEntries(Object.entries(gross).map(([r, v]) => [r, Number(v) || 0]));
    const total = Object.values(g).reduce((s, x) => s + x, 0);
    const P = fkIssuePlan(L.ctx, [{ date, total, gross: g }], G, wh, meth as FkMethod, nonVat);
    const names = new Map((L.ctx.items ?? []).map((i) => [i.id, (i.code ? i.code + ' · ' : '') + i.name]));
    plan = P[0]!.lines.map((l) => ({ itemId: l.item, label: names.get(l.item) ?? l.item, qty: l.qty, price: l.price, rate: l.rate }));
  }
  // AI read of a fiscal report (legacy `fkRead`, FISK_PROMPT): prefill the editor with one report row (`?ai=<id>&r=<i>`)
  const aiDoc = write ? await loadAiResult(firm.id, sp.ai, 'fisk') : null;
  let aiRows: { rows: FiskEditorRow[]; daily: boolean; R: FiskRead; read: ReadRow[]; G: Record<string, number> } | null = null;
  let aiInit: Partial<FiskDraft> = {};
  if (aiDoc) {
    const R = fiskFinish(fiskAfterRead(aiDoc.result), todayIso());
    const X = fiskEditorRows(R, { today: todayIso(), nonVat: nonVat || undefined });
    // legacy read table with the control checks (`fkCheck` 11351)
    const Y = fkRows(R, todayIso());
    aiRows = { ...X, R, G: Y.G, read: Y.rows.map((r) => ({ date: r.date, z: r.z, gross: r.gross, vat: r.vat, total: r.total, cash: r.cash, card: r.card, problems: nonVat ? [] : fkCheck(r, Y.G) })) };
    const r = X.rows[Math.min(Math.max(0, Number(sp.r) || 0), Math.max(0, X.rows.length - 1))];
    if (r) {
      aiInit = {
        date: dateInYear(r.date, year), number: r.z || [R.zFrom, R.zTo].filter(Boolean).join('–'),
        gross: Object.fromEntries(Object.entries(r.gross).filter(([, v]) => v).map(([k, v]) => [k, String(v)])), total: String(r.total || ''), card: r.card ? String(r.card) : '',
        from: X.daily ? '' : R.from ?? '', to: X.daily ? '' : R.to ?? '', note: R.device ? `ФМ ${R.device}` : '',
      };
    }
  }
  const schemes: [string, string][] =[['', 'Без шема: Д благајна / Д картичка / П приход + ДДВ'], ...Object.entries(FISCAL_SCHEMES).map(([k, v]) => [k, v[0]] as [string, string])];
  const list = await db().select().from(salesDaily)
    .where(and(eq(salesDaily.firmId, firm.id), eq(salesDaily.kind, 'fisk'), gte(salesDaily.date, `${year}-01-01`), lte(salesDaily.date, `${year}-12-31`)))
    .orderBy(desc(salesDaily.date));

  const devs = (((firm.settings ?? {}) as { fiskDev?: FiskDevice[] }).fiskDev ?? []);
  const readDevs = [...new Set(list.map((d) => d.fisk?.device).filter((x): x is string => !!x))];
  const pos = tab === 'list' ? await db().transaction((tx) => posBalance(tx, firm.id, year)).catch(() => null) : null;
  let dfi: ReturnType<typeof dfiControl> | null = null;
  let [from, to] = rangeOf(sp, year);
  if (tab === 'dfi') {
    const [sales, ledger] = await Promise.all([loadStockSales(db(), firm.id), loadLedgerLines(db(), firm.id, `${year}-01-01`, to)]);
    // legacy `dfiStart` (13130): without an explicit "from", the control starts at the first report of the location
    const W = pickLoc(L, sp.wh);
    const first = sales.filter((s) => !W || s.wh === W).map((s) => s.days?.[0]?.date ?? s.date).sort()[0];
    if (!sp.from && first && first > from) from = first;
    dfi = dfiControl({
      sales, wh: pickLoc(L, sp.wh) || undefined, from, to, today: todayIso(), opts: { offDays: O.offDays, cashMax: O.cashMax, depDays: O.depDays, cardK: O.cardK },
      ledger: ledger.map((l) => ({ account: l.account, date: l.date, debit: l.debit, credit: l.credit })),
      posAccount: (firm.settings as Record<string, unknown>)?.posK as string | undefined,
    });
  }
  return (
    <>
      <Hd t="📠 Фискални извештаи" sub="рачна каса · дневни и периодични извештаи" />
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <Link className={`btn sm ${tab === 'list' ? 'pri' : ''}`} href="/fiskPer">Внес и листа</Link>
        <Link className={`btn sm ${tab === 'dfi' ? 'pri' : ''}`} href="/fiskPer?tab=dfi">Контрола на ДФИ</Link>
        <Link className={`btn sm ${tab === 'dev' ? 'pri' : ''}`} href="/fiskPer?tab=dev">🖨 Апарати и PC поврзување</Link>
        <Link className="btn sm" href="/kdfi">КДФИ-01</Link>
        <Link className="btn sm" href="/m_trg">МЕТГ</Link>
        <Link className="btn sm" href="/ddv">ДДВ-04</Link>
      </div>
      {tab === 'list' && pos && pos.state !== 'none' && pos.state !== 'closed' && (
        <div className="callout">💳 <b>Плаќања со картички (POS, конто {pos.k})</b>: продажба со картички {fmt(pos.d / 100)} · примено од банка {fmt(pos.p / 100)} · отворено <b>{fmt(pos.s / 100)}</b>.
          {pos.state === 'fee' ? <> Разликата е најчесто провизијата на банката – <Link href="/banka#posBox">книжи ја провизијата (4460) во Изводи</Link>.</> : pos.state === 'waiting' ? ' Банката сè уште не ги уплатила.' : ' Примено е повеќе отколку продадено.'}</div>
      )}
      {tab === 'list' && write && !aiDoc && <FiskScan firmId={firm.id} />}
      {tab === 'list' && aiRows && write && (
        <FiskReadPanel ai={aiDoc!.id} rows={aiRows.read} G={aiRows.G} daily={aiRows.daily} device={aiRows.R.device ?? ''}
          period={[aiRows.R.from, aiRows.R.to].filter(Boolean).join(' – ')} text={aiRows.R.text ?? ''} text2={aiRows.R.text2 ?? ''}
          locs={locs} schemes={schemes} dupDates={list.map((d) => `${d.date}|${d.locationId ?? 'main'}`)}
          init={{ wh, sc: O.sc ?? (nonVat || aiRows.R.nonVat ? 'trgNoVat' : ''), rev: (O as { konto?: string }).konto ?? '', cardK: O.cardK ?? '', cashK: O.cashK ?? '', nonVat: nonVat || !!aiRows.R.nonVat }} />
      )}
      {tab === 'list' && aiRows && (
        <div className="callout">✎ Рачна корекција на еден ред од прочитаниот извештај{aiRows.R.device ? ` (ФМ ${aiRows.R.device})` : ''}: {aiRows.rows.length} {aiRows.daily ? 'дневни извештаи' : 'период'} ·
          вкупно {fmt(aiRows.rows.reduce((a, r) => a + r.total, 0))}. Проверете ги износите и прокнижете.
          {aiRows.rows.length > 1 && <div className="row" style={{ gap: 4, marginTop: 6, flexWrap: 'wrap' }}>{aiRows.rows.map((r, i) => (
            <Link key={i} className={`btn sm ${(Number(sp.r) || 0) === i ? 'pri' : ''}`} href={`/fiskPer?ai=${aiDoc!.id}&r=${i}`}>{dmy(r.date)}{r.z ? ` Z ${r.z}` : ''} · {fmt(r.total)}</Link>
          ))}</div>}
          {' '}<Link className="btn sm ghost" href="/fiskPer">Откажи</Link>
        </div>
      )}
      {tab === 'list' && write && (
        <FiskEditor key={aiDoc ? `${aiDoc.id}:${sp.r ?? 0}` : 'new'} locs={locs} schemes={schemes} nonVat={nonVat} plan={plan}
          initial={{
            date, wh, number: sp.n ?? '', gross, total: sp.t ?? '', card: sp.c ?? '', sc: sp.sc ?? O.sc ?? (nonVat ? 'trgNoVat' : ''), from: sp.f ?? '', to: sp.tt ?? '', meth, issue: !!plan?.length, note: sp.note ?? '',
            rev: sp.rev ?? (O as { konto?: string }).konto ?? '', cardK: sp.ck ?? O.cardK ?? '', cashK: sp.cash ?? O.cashK ?? '', device: sp.dev ?? '', nonVat: sp.nv === '1', ...aiInit,
          }} />
      )}
      {tab === 'list' && (list.length ? (
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Z бр.</th><th>Објект</th><th>Шема</th><th className="n">Вкупно</th><th className="n">Картичка</th><th>ДДВ групи</th><th className="n">Ставки (стока)</th><th /></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td>{dmy(d.date)}{d.fisk?.from && d.fisk?.to ? <span className="mini"> ({dmy(d.fisk.from)}–{dmy(d.fisk.to)})</span> : null}</td>
                <td>{d.number}</td><td>{L.locName(d.locationId)}</td><td>{d.fisk?.sc ?? '—'}</td><td className="n">{fmt(d.total)}</td><td className="n">{fmt(d.card)}</td>
                <td className="mini">{d.groups.map((g) => `${g.rate}%: ${fmt(g.base + g.vat)}`).join(' · ')}</td><td className="n">{d.lines.length}</td>
                <td>{write && <RowAction action={deleteSalesDayAction.bind(null, d.id)} label="🗑" title="Избриши" confirm={`Да се избрише извештајот ${d.number ?? ''} од ${dmy(d.date)}?`} />}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <div className="card empty">Нема внесени фискални извештаи во {year}.</div>)}
      {tab === 'dev' && (
        <div className="card">
          <h2>🖨 Фискални апарати и PC поврзување</h2>
          {devs.length > 0 && (
            <div className="tw"><table className="dense">
              <thead><tr><th>Сериски број</th><th>Објект</th><th>Марка / модел</th><th>Поврзување</th><th>Порт / IP</th><th>Оператор</th><th>Режим</th><th>Фискализиран</th><th>Сервисер</th><th>Последен / следен сервис</th><th /></tr></thead>
              <tbody>{devs.map((d) => (
                <tr key={d.id}><td><b>{d.serial}</b></td><td>{L.locName(d.wh || 'main')}</td><td>{d.brand} {d.model}</td><td>{d.conn}</td><td>{d.port}</td><td>{d.operator}</td><td>{d.mode}</td><td>{d.fiscal}</td><td>{d.servicer}</td>
                  <td>{d.lastSvc ? dmy(d.lastSvc) : ''}{d.nextSvc ? ' / ' + dmy(d.nextSvc) : ''}{d.nextSvc && d.nextSvc < todayIso() ? <span className="pill bad"> задоцнет</span> : null}</td>
                  <td>{write && <RowAction action={deleteDeviceAction.bind(null, d.id)} label="🗑" confirm={`Да се избрише апаратот ${d.serial}?`} />}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {readDevs.length > 0 && <p className="note">Прочитани апарати од извештаите: {readDevs.map((x) => <b key={x}>{x} </b>)}</p>}
          {write && <DeviceForm locs={locs} suggest={readDevs.find((x) => !devs.some((d) => d.serial === x)) ?? ''} />}
        </div>
      )}
      {tab === 'dfi' && dfi && (
        <>
          {write && <DfiSettings offDays={O.offDays ?? ''} cashMax={O.cashMax ?? 0} depDays={O.depDays ?? 0} />}
          <form className="card">
            <input type="hidden" name="tab" value="dfi" />
            <div className="row" style={{ gap: 12, alignItems: 'end' }}>
              <label className="f">Објект<select name="wh" defaultValue={pickLoc(L, sp.wh)}><option value="">сите објекти</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
              <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
              <button className="btn">Провери</button>
            </div>
          </form>
          {dfi.F.length ? dfi.F.map((f, i) => (
            <div key={i} className={`callout ${f.sev === 'bad' ? 'bad' : f.sev === 'warn' ? 'warn' : ''}`} dangerouslySetInnerHTML={{ __html: f.t.replace(/<(?!\/?b>)/g, '&lt;') }} />
          )) : <div className="callout good">Нема забелешки за дневните фискални извештаи во периодот.</div>}
          <div className="tw"><table>
            <thead><tr><th>Датум</th><th>Z бр.</th><th>Објект</th><th className="n">Промет</th><th /></tr></thead>
            <tbody>{dfi.D.map((d, i) => <tr key={i}><td>{dmy(d.date)}</td><td>{d.z}</td><td>{L.locName(d.wh)}</td><td className="n">{fmt(d.total)}</td><td>{d.est ? <span className="pill warn">распределено</span> : d.pos ? <span className="pill">каса</span> : ''}</td></tr>)}</tbody>
          </table></div>
        </>
      )}
    </>
  );
}
