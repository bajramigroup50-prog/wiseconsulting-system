/**
 * 📠 Фискални апарати — legacy `VIEWS.fiskPer` (v2 11411 + tabs 11528 + wrappers 13043–13152):
 *  - „📠 Извештаи → книжење“: POS-terminal balance with „Книжи провизија 4460“ (`posBox`, 13076), scan / PDF read
 *    (`fkRead`, FISK_PROMPT + FK_SIMPLE second read in the worker), „✎ Внеси рачно“ (`fkManual`, here the full manual
 *    form), the read result with all days at once — checks, VAT status, per-day / summed posting, posting date, МЕТГ
 *    days, scheme, accounts, warnings (`FiskReadPost`) — and „2. Излез на стока“ (FIFO / LIFO / proportional), plus the
 *    posted reports with the scanned file (archive);
 *  - „✅ Контрола на ДФИ“ (`dfiHTML` → `dfiControl`) with the options (non-working days, cash maximum, deposit days) and
 *    the print shortcuts КДФИ-01 / МЕТГ / ДДВ-04;
 *  - „🖨 Апарати и PC поврзување“ (`devHTML`): fiscal devices per location, devices seen on reports, the bridge plan.
 */
import Link from 'next/link';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { dfiControl, fkIssuePlan, schemeValue, stock, type FkMethod } from '@wise/core';
import { fkRows, fiskAfterRead, fiskFinish } from '@wise/core/ai/fisk';
import { FK_SC, fkChecks2, fkEdbOk, fkManualRead, fkRows2, fkScDef, posSaldo } from '@wise/core/retail';
import { fiscalDevicesOf, journalLines, journals, loadLedgerLines, loadStockSales, salesDaily } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dateInYear, locOptions, pickLoc, rangeOf, stockPage, todayIso } from '@/lib/stock';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { BankForm } from '@/components/bank-form';
import { PdfButton } from '@/components/pdf-button';
import { DownloadCsv } from '@/components/download-csv';
import { FTabs } from '@/components/loc-select';
import { deleteSalesDayAction } from '../_stock/actions';
import { FiskEditor } from '../_stock/editors';
import { loadAiResult } from '@/lib/ai';
import { FiskScan } from './fisk-scan';
import { FiskReadPost, type PlanRow, type ReadRow } from './fisk-read';
import { FiskManual } from './fisk-manual';
import { devDelAction, devSaveAction, dfiOptAction, posFeeAction } from './actions';

type SP = {
  ai?: string; tab?: string; d?: string; wh?: string; meth?: string; g18?: string; g10?: string; g5?: string; g0?: string; from?: string; to?: string;
  nv?: string; sum?: string; sc?: string; man?: string; det?: string; mt?: string; mf?: string; md?: string; mc?: string; mg?: string; ma?: string; posted?: string; tot?: string; iss?: string; dev?: string;
};

const FK_BRANDS = ['Accent / Expert', 'David', 'Duna', 'Synergy', 'Daisy', 'Tremol', 'Datecs', 'Друго'];
const CONN: Record<string, string> = { usb: 'USB (виртуелен COM порт)', com: 'Сериски COM порт', lan: 'Мрежа (LAN / IP)', none: 'Не е поврзан' };
const MODE: Record<string, string> = { manual: 'Рачно – извештаите се носат и скенираат', file: 'Датотека (.inp) за програмата на производителот', bridge: 'Директно – локален мост (кога ќе се инсталира)' };
const MODE_SHORT: Record<string, string> = { manual: 'Рачно – извештаи се скенираат', file: 'Датотека за програмата на производителот', bridge: 'Директно (локален мост)' };
const daysTo = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 864e5);

export default async function FiskPerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year, L } = await stockPage('fiskPer');
  if (!firm || !L) return <NoFirm t="Фискални апарати" />;
  const write = canDo(u, 'fkPost', firm.id);
  const tab = sp.tab === 'ctl' || sp.tab === 'dfi' ? 'ctl' : sp.tab === 'dev' ? 'dev' : 'rep';
  const locs = locOptions(L);
  const O = L.settings.fiskOpt as typeof L.settings.fiskOpt & { konto?: string };
  const today = todayIso();
  const posK = L.settings.posting.firm.posK || schemeValue(L.settings.posting, 'posCard') || '1200001';
  const tabs = <FTabs active={tab} tabs={[['rep', '📠 Извештаи → книжење', '/fiskPer'], ['ctl', '✅ Контрола на ДФИ', '/fiskPer?tab=ctl'], ['dev', '🖨 Апарати и PC поврзување', '/fiskPer?tab=dev']]} />;

  /* ---------------- ✅ Контрола на ДФИ ---------------- */
  if (tab === 'ctl') {
    let [from, to] = rangeOf(sp, year);
    const W = sp.wh !== undefined ? pickLoc(L, sp.wh) : (O.wh ?? '');
    const [sales, ledger] = await Promise.all([loadStockSales(db(), firm.id), loadLedgerLines(db(), firm.id, `${year}-01-01`, to)]);
    // legacy `dfiStart` (13130): without an explicit "from", the control starts at the first fiscal report of the location
    const first = sales.filter((s) => (!W || s.wh === W) && (s.fisk || /^zf-/.test(s.id))).map((s) => (s.fisk?.from as string | undefined) || s.date).filter((d) => d.startsWith(String(year))).sort()[0];
    if (!sp.from && first && first > from) from = first;
    const R = dfiControl({
      sales, wh: W || undefined, from, to, today, opts: { offDays: O.offDays, cashMax: O.cashMax, depDays: O.depDays, cardK: O.cardK },
      ledger: ledger.map((l) => ({ account: l.account, date: l.date, debit: l.debit, credit: l.credit })), posAccount: posK,
    });
    const bad = R.F.filter((x) => x.sev === 'bad').length, warn = R.F.filter((x) => x.sev === 'warn').length;
    return (
      <>
        <Hd t="Фискални апарати" sub="контрола на дневни финансиски извештаи" />
        {tabs}
        <div className="card">
          <form className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <input type="hidden" name="tab" value="ctl" />
            <label className="mini">Објект<select name="wh" defaultValue={W} style={{ width: 'auto' }}><option value="">сите</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label className="mini">Од<input type="date" name="from" defaultValue={from} /></label>
            <label className="mini">До<input type="date" name="to" defaultValue={to} /></label>
            <button className="btn sm">Провери</button>
          </form>
          {write && <BankForm action={dfiOptAction} className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}>
            <label className="mini">Неработни денови<select name="offDays" defaultValue={O.offDays ?? '0'} style={{ width: 'auto' }}><option value="0">недела</option><option value="0,6">сабота и недела</option><option value="">нема (секој ден)</option></select></label>
            <label className="mini">Благајнички максимум<input name="cashMax" type="number" defaultValue={O.cashMax || ''} placeholder="ден." style={{ width: 110 }} /></label>
            <label className="mini">Полог до (дена)<input name="depDays" type="number" defaultValue={O.depDays || 3} style={{ width: 70 }} /></label>
            <button className="btn sm">Зачувај</button>
          </BankForm>}
          <div className="row" id="dfiPrint" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="note" style={{ margin: 0 }}>За печатење:</span>
            <Link className="btn sm pri" href={`/kdfi?from=${from}&to=${to}${W ? '&wh=' + W : ''}`}>📒 КДФИ-01 – книга на дневни финансиски извештаи (PDF)</Link>
            <Link className="btn sm" href="/m_trg">📒 МЕТГ – евиденција во трговија на мало</Link>
            <Link className="btn sm" href="/ddv">ДДВ-04</Link>
          </div>
        </div>
        <div className="card" style={{ borderColor: bad ? 'var(--bad)' : warn ? 'var(--warn)' : 'var(--good)' }}>
          <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Контрола на дневните финансиски извештаи</h2>
            {bad > 0 && <span className="pill bad">{bad} грешки</span>}{warn > 0 && <span className="pill warn">{warn} за проверка</span>}{!bad && !warn && <span className="pill good">✓ во ред</span>}</div>
          {R.F.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{R.F.map((x, i) => (
            <li key={i} style={{ margin: '3px 0' }}><span className={`pill ${x.sev === 'bad' ? 'bad' : x.sev === 'warn' ? 'warn' : ''}`}>{x.sev === 'bad' ? 'грешка' : x.sev === 'warn' ? 'провери' : 'инфо'}</span> <span dangerouslySetInnerHTML={{ __html: x.t.replace(/<(?!\/?b>)/g, '&lt;') }} /></li>
          ))}</ul> : <p className="mini" style={{ margin: 0 }}>Секој работен ден има извештај, Z броевите одат по ред, пазарот е уплатен.</p>}
          <p className="mini" style={{ margin: '8px 0 0' }}>Се проверува: денови без Z, прескокнати / двојни Z броеви, повеќе извештаи во ист ден, нула промет, распределени денови, готовина над благајничкиот максимум и неуплатен пазар, неприлив од картички.</p>
        </div>
        <div className="card">
          <div className="hd"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Дневни извештаи ({R.D.length})</h2>
            <div className="row noprint" style={{ gap: 6 }}><PdfButton selector="#dfiList" title={`Контрола на ДФИ ${dmy(from)} – ${dmy(to)}`} className="btn sm" />
              <DownloadCsv name={`DFI_${from}_${to}.csv`} rows={[['Датум', 'Z бр.', 'Објект', 'Промет', 'Распределено'], ...R.D.map((d) => [dmy(d.date), d.z || '', L.locName(d.wh), d.total, d.est ? 'да' : ''])]} /></div></div>
          <div className="tw" id="dfiList" style={{ maxHeight: 340, overflow: 'auto' }}><table className="dense">
            <thead><tr><th>Датум</th><th>Z бр.</th><th>Објект</th><th className="n">Промет</th><th /></tr></thead>
            <tbody>{R.D.map((d, i) => <tr key={i}><td>{dmy(d.date)}</td><td>{d.z || '—'}</td><td>{L.locName(d.wh)}</td><td className="n">{fmt(d.total)}</td><td>{d.est ? <span className="pill warn">распределено</span> : d.pos ? <span className="pill">каса</span> : ''}</td></tr>)}
              {!R.D.length && <tr><td colSpan={5} className="note">Нема извештаи во периодот.</td></tr>}</tbody>
          </table></div>
        </div>
      </>
    );
  }

  /* ---------------- 🖨 Апарати и PC поврзување ---------------- */
  if (tab === 'dev') {
    const D = fiscalDevicesOf(firm.settings);
    const S = await db().select({ fisk: salesDaily.fisk }).from(salesDaily).where(eq(salesDaily.firmId, firm.id));
    const seen = [...new Set(S.map((s) => s.fisk?.device).filter((x): x is string => !!x))].filter((x) => !D.some((d) => d.serial === x));
    const ei = sp.dev === 'new' || (sp.dev ?? '').startsWith('s:') ? -1 : sp.dev !== undefined ? Number(sp.dev) : null;
    const E = ei == null ? null : ei >= 0 ? D[ei] ?? null : { serial: (sp.dev ?? '').startsWith('s:') ? sp.dev!.slice(2) : '', wh: O.wh || locs.find((l) => l.kind === 'store')?.id || 'main', mode: 'manual' as const, conn: 'usb' as const };
    const sel = (name: string, opts: [string, string][], v: string | undefined) => <select name={name} defaultValue={v} style={{ width: 'auto' }}>{opts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>;
    return (
      <>
        <Hd t="Фискални апарати" sub="апарати и поврзување со компјутер" />
        {tabs}
        <div className="callout">Евиденција на фискалните апарати по објект и подготовка за <b>директно поврзување со компјутер</b>. Од прелистувачот апаратот не може да се управува директно; тоа ќе го прави мала локална програма (мост) што ќе се инсталира на компјутерот во продавницата – тогаш сметката од системот се печати на апаратот и Z извештајот автоматски се враќа во програмата. Тука ги внесувате податоците што ќе ги користи мостот.</div>
        {seen.length > 0 && <div className="callout warn">Од прочитаните извештаи се пронајдени апарати што не се евидентирани: {seen.map((x) => <span key={x}><b>{x}</b> {write && <Link className="btn sm" href={`/fiskPer?tab=dev&dev=s:${encodeURIComponent(x)}`}>+ додај</Link>} </span>)}</div>}
        <div className="tw"><table className="dense">
          <thead><tr><th>Фискален број / сериски</th><th>Објект</th><th>Марка / модел</th><th>Поврзување</th><th>Начин на работа</th><th>Следен сервис</th><th /></tr></thead>
          <tbody>{D.map((d, i) => (
            <tr key={i}><td><b>{d.serial}</b></td><td>{L.locName(d.wh === 'main' ? null : d.wh)}</td><td>{[d.brand, d.model].filter(Boolean).join(' ')}</td>
              <td className="mini">{d.conn === 'usb' ? 'USB (виртуелен COM)' : d.conn === 'com' ? 'COM ' + (d.port ?? '') : d.conn === 'lan' ? 'LAN ' + (d.ip ?? '') : '—'}{d.baud ? ' · ' + d.baud : ''}</td>
              <td className="mini">{MODE_SHORT[d.mode || 'manual']}</td>
              <td>{d.next ? (d.next < today ? <span className="pill bad">{dmy(d.next)}</span> : daysTo(today, d.next) <= 30 ? <span className="pill warn">{dmy(d.next)}</span> : dmy(d.next)) : '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{write && <Link className="btn sm" href={`/fiskPer?tab=dev&dev=${i}`}>Измени</Link>}{canDo(u, 'del', firm.id) && <RowAction action={devDelAction.bind(null, i)} label="🗑" style={{ color: 'var(--bad)' }} confirm="Да се избрише апаратот од евиденцијата?" />}</td></tr>
          ))}{!D.length && <tr><td colSpan={7} className="note">Нема евидентирани апарати.</td></tr>}</tbody>
        </table></div>
        {write && <div className="row" style={{ marginTop: 8 }}><Link className="btn pri" href="/fiskPer?tab=dev&dev=new">+ Нов фискален апарат</Link></div>}
        {E && write && (
          <BankForm action={devSaveAction} className="card" style={{ borderColor: 'var(--accent)', marginTop: 10 }}>
            <input type="hidden" name="i" value={ei ?? -1} />
            <div className="form">
              <label className="f">Фискален број / сериски<input name="serial" defaultValue={E.serial} /></label>
              <label className="f">Објект{sel('wh', locs.map((l) => [l.id, l.name]), E.wh || 'main')}</label>
              <label className="f">Марка{sel('brand', FK_BRANDS.map((b) => [b, b]), E.brand || FK_BRANDS[0])}</label>
              <label className="f">Модел<input name="model" defaultValue={E.model ?? ''} /></label>
              <label className="f">Поврзување со PC{sel('conn', Object.entries(CONN), E.conn || 'usb')}</label>
              <label className="f">COM порт<input name="port" defaultValue={E.port ?? ''} placeholder="COM3" /></label>
              <label className="f">Брзина (baud)<input name="baud" defaultValue={E.baud ?? ''} placeholder="9600 / 115200" /></label>
              <label className="f">IP адреса<input name="ip" defaultValue={E.ip ?? ''} placeholder="192.168.1.50" /></label>
              <label className="f">Оператор / лозинка на апаратот<input name="op" defaultValue={E.op ?? ''} placeholder="на пр. 1 / 0000" /></label>
              <label className="f">Начин на работа{sel('mode', Object.entries(MODE), E.mode || 'manual')}</label>
              <label className="f">Фискализиран на<input name="fisc" type="date" defaultValue={E.fisc ?? ''} /></label>
              <label className="f">Сервисер<input name="servicer" defaultValue={E.servicer ?? ''} /></label>
              <label className="f">Последен сервис<input name="last" type="date" defaultValue={E.last ?? ''} /></label>
              <label className="f">Следен сервис / контрола<input name="next" type="date" defaultValue={E.next ?? ''} /></label>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}><Link className="btn" href="/fiskPer?tab=dev">Откажи</Link><button className="btn pri">Зачувај</button></div>
          </BankForm>
        )}
        <div className="card" style={{ marginTop: 10 }}><b>Што ќе прави локалниот мост (фаза: инсталирана апликација)</b>
          <ul className="mini" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>Сметка од „Фискална каса“ → печатење на апаратот (артикли, ДДВ група, плаќање готовина/картичка), враќа број на фискална сметка.</li>
            <li>Сторно / поврат на апаратот.</li>
            <li>Дневен (Z) извештај на крај на денот → автоматски влегува во Каса, КДФИ и МЕТГ (без скенирање).</li>
            <li>Периодичен извештај од апаратот по датуми / Z броеви.</li>
            <li>Синхронизација на артикли и цени (PLU) со апаратот.</li>
            <li>Проверка на врска и статус на апаратот (хартија, фискална меморија, грешки).</li>
          </ul>
          <p className="mini" style={{ margin: '6px 0 0' }}>За секоја марка се користи протоколот на производителот – затоа е важно да се евидентира марката и моделот.</p></div>
      </>
    );
  }

  /* ---------------- 📠 Извештаи → книжење ---------------- */
  const vatReg = L.settings.vatRegistered;
  // POS terminal box (legacy `posBox` 13076)
  const posLines = await db().select({ account: journalLines.account, date: journals.date, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId)).where(and(eq(journals.firmId, firm.id), eq(journalLines.account, posK)));
  const ps = posSaldo(posLines.map((l) => ({ ...l, date: String(l.date) })), posK);
  const pct = ps.d ? (ps.s / ps.d) * 100 : 0;

  // AI read of a fiscal report — all days at once (legacy fkRows2 / FiskReadPost)
  const aiDoc = write ? await loadAiResult(firm.id, sp.ai, 'fisk') : null;
  // „✎ Внеси рачно (само вкупно)“ (legacy fkManual): the entered total is shown and posted like a read report
  const mGroup = (['Г0', 'А', 'Б', 'В', 'Г'] as const).find((g) => g === sp.mg);
  const manualIn = write && !aiDoc && Number(sp.mt) > 0 && sp.mf && sp.md && mGroup
    ? { total: Number(sp.mt), from: sp.mf, to: sp.md, card: Number(sp.mc) || 0, group: mGroup, device: sp.ma ?? '' } : null;
  let read: React.ReactNode = null;
  if (aiDoc || manualIn) {
    const R = aiDoc ? fiskFinish(fiskAfterRead(aiDoc.result), today) : fkManualRead(manualIn!);
    let nonVat = sp.nv ? sp.nv === '1' : (R.nonVat ?? !vatReg);
    const sc = fkScDef(sp.sc, O.sc, nonVat);
    if (sc === 'trgNoVat') nonVat = true;
    const sum = sp.sum ? sp.sum === '1' : true;
    const wh = pickLoc(L, sp.wh) || O.wh || locs.find((l) => l.kind === 'store')?.id || 'main';
    const meth = (['fifo', 'lifo', 'prop'].includes(sp.meth ?? '') ? sp.meth : O.meth || 'fifo') as 'fifo' | 'lifo' | 'prop';
    const X0 = fkRows(R, today);
    const X = fkRows2(R, { nonVat, sum, today });
    const rows: ReadRow[] = X.rows.map((r) => ({ date: r.date, z: r.z, gross: r.gross, vat: r.vat, total: r.total, cash: r.cash, card: r.card, probs: fkChecks2(r, X.G, nonVat, (x) => fmt(x)) }));
    const Ls = Object.keys(X.G).filter((k) => X.rows.some((r) => r.gross[k]));
    const dates = X.rows.map((r) => r.date).sort();
    const pFrom = (R.from && /^\d{4}/.test(R.from) ? R.from : '') || dates[0]!, pTo = (R.to && /^\d{4}/.test(R.to) ? R.to : '') || dates[dates.length - 1]!;
    const ex = await db().select({ id: salesDaily.id, loc: salesDaily.locationId }).from(salesDaily)
      .where(and(eq(salesDaily.firmId, firm.id), gte(salesDaily.date, pFrom), lte(salesDaily.date, pTo)));
    const existing = ex.filter((e) => (e.loc ?? 'main') === wh).length;
    const W = wh === 'main' ? 'main' : wh;
    const hasGoods = (L.ctx.items ?? []).some((it) => it.type === 'goods' && stock(L.ctx, it.id, W).qty > 0);
    let plan: PlanRow[] | null = null, planTarget = 0, planRest = 0;
    if (sc === 'trg' && hasGoods) {
      const P = fkIssuePlan(L.ctx, X.rows.map((r) => ({ date: r.date, z: r.z, total: r.total, gross: r.gross })), X.G, W, meth as FkMethod, X.nonVat);
      const I = new Map((L.ctx.items ?? []).map((i) => [i.id, i]));
      plan = P.flatMap((d) => d.lines.map((l) => ({ date: d.date, name: I.get(l.item)?.name ?? '', unit: I.get(l.item)?.unit ?? '', rate: l.rate, qty: l.qty, price: l.price })));
      planTarget = P.reduce((a, d) => a + d.target, 0);
      planRest = P.reduce((a, d) => a + d.rest, 0);
    }
    const rev = FK_SC[sc][1] || O.konto || schemeValue(L.settings.posting, 'revRetail') || '7411';
    const txt = [R.text, R.text2].map((x) => String(x || '').trim()).filter(Boolean).join('\n\n— втор обид —\n\n');
    const tot = X.rows.reduce((a, r) => a + r.total, 0);
    read = (
      <>
        <div className={`callout ${tot > 0 ? 'good' : 'warn'}`}>{manualIn ? <>✎ Внесено рачно: вкупен промет {fmt(tot)} ден. Проверете и прокнижете.</> : tot > 0
          ? <>✓ Прочитано{X0.daily ? `: ${X0.rows.length} дневни извештаи` : ''}{R.text2 ? ' (втор обид)' : ''}: вкупен промет {fmt(tot)} ден. Проверете ги износите.</>
          : <>⚠ Износот не можеше да се прочита од сликата. Сликајте го поблиску (само лентата, исправено, без сенка) или „✎ Внеси рачно (само вкупно)“.</>}
          {' '}<Link className="btn sm ghost" href="/fiskPer">✕ Почни одново</Link></div>
        {aiDoc && <details id="fkTxt" className="card" style={{ padding: '8px 12px' }}><summary className="mut" style={{ cursor: 'pointer' }}>📝 Што е прочитано од сликата (за проверка)</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 320, overflow: 'auto' }}>{txt || '(програмата не врати текст)'}</pre>
          <p className="note">Апарат: {R.device || '—'} · период: {R.from || '—'} – {R.to || '—'} · вкупно: {fmt(Number(R.totals?.total) || 0)}</p></details>}
        {tot > 0 && <FiskReadPost ai={aiDoc?.id ?? null} manual={manualIn} from={pFrom} to={pTo} device={R.device ?? ''} edb={R.edb ?? ''} edbOk={fkEdbOk(firm.edb, R.edb)} G={X.G} Ls={Ls}
          rows={rows} daily={X0.daily} dayCount={X0.rows.length} nonVat={nonVat} sum={sum} sc={sc} schemes={Object.entries(FK_SC).map(([k, v]) => [k, v[0]])}
          wh={wh} locs={locs} rev={rev} cashK={O.cashK || '1009'} cardK={O.cardK && O.cardK !== '1009' ? O.cardK : posK} existing={existing}
          meth={meth} plan={plan} planTarget={planTarget} planRest={planRest} hasGoods={hasGoods} />}
      </>
    );
  }

  // manual entry (legacy `fkManual` → here the full form with the goods-issue plan)
  const manual = !aiDoc && !manualIn && (sp.det === '1' || ['g18', 'g10', 'g5', 'g0'].some((k) => sp[k as 'g18']));
  let editor: React.ReactNode = null;
  if (write && !aiDoc && !manualIn && sp.man === '1') editor = <FiskManual year={year} today={today} nonVat0={!vatReg} />;
  if (manual && write) {
    const wh = pickLoc(L, sp.wh) || O.wh || locs.find((l) => l.kind === 'store')?.id || 'main';
    const date = dateInYear(sp.d, year);
    const meth = (['fifo', 'lifo', 'prop'].includes(sp.meth ?? '') ? sp.meth : O.meth || 'fifo') as 'fifo' | 'lifo' | 'prop';
    const gross: Record<string, string> = {};
    for (const r of ['18', '10', '5', '0']) { const v = sp[('g' + r) as 'g18']; if (v) gross[r] = v; }
    let plan: { itemId: string; label: string; qty: number; price: number; rate: number }[] | null = null;
    if (Object.keys(gross).length) {
      const G: Record<string, number> = { 18: 18, 10: 10, 5: 5, 0: 0 };
      const g = Object.fromEntries(Object.entries(gross).map(([r, v]) => [r, Number(v) || 0]));
      const total = Object.values(g).reduce((s, x) => s + x, 0);
      const P = fkIssuePlan(L.ctx, [{ date, total, gross: g }], G, wh, meth as FkMethod, !vatReg);
      const names = new Map((L.ctx.items ?? []).map((i) => [i.id, (i.code ? i.code + ' · ' : '') + i.name]));
      plan = P[0]!.lines.map((l) => ({ itemId: l.item, label: names.get(l.item) ?? l.item, qty: l.qty, price: l.price, rate: l.rate }));
    }
    editor = <FiskEditor locs={locs} schemes={[['', 'Без шема: Д благајна / Д картичка / П приход + ДДВ'], ...Object.entries(FK_SC).map(([k, v]) => [k, v[0]] as [string, string])]} nonVat={!vatReg} plan={plan}
      initial={{ date, wh, number: '', gross, total: '', card: '', sc: O.sc ?? (!vatReg ? 'trgNoVat' : ''), from: '', to: '', meth, issue: !!plan?.length, note: '' }} />;
  }

  const list = await db().select().from(salesDaily)
    .where(and(eq(salesDaily.firmId, firm.id), eq(salesDaily.kind, 'fisk'), gte(salesDaily.date, `${year}-01-01`), lte(salesDaily.date, `${year}-12-31`)))
    .orderBy(desc(salesDaily.date));
  return (
    <>
      <Hd t="Фискални извештаи (рачна каса)" sub="скенирај → прочитај → прокнижи → излез на стока" />
      {tabs}
      {(ps.d || ps.p) ? (
        <div className="callout" id="posBox">💳 <b>POS терминал – конто {ps.k}</b>: картички од фискални извештаи <b>{fmt(ps.d)}</b> · примено од банка <b>{fmt(ps.p)}</b> · отворено <b>{fmt(ps.s)}</b>
          {ps.s > 0.009 && ps.p > 0 ? <> ({pct.toFixed(2)}%). Ако банката ги уплатила сите картички за периодот, разликата е провизија на банката.
            {write && <BankForm action={posFeeAction} className="row" style={{ gap: 6, alignItems: 'end', marginTop: 6 }} confirm="Да се прокнижи провизијата Д 4460 / П POS конто?">
              <input type="hidden" name="max" value={ps.s.toFixed(2)} />
              <label className="mini">Износ<input name="amount" inputMode="decimal" defaultValue={ps.s.toFixed(2)} style={{ width: 110 }} /></label>
              <label className="mini">Датум<input name="date" type="date" defaultValue={ps.last || today} /></label>
              <button className="btn sm pri">Книжи провизија 4460</button></BankForm>}</>
            : ps.s > 0.009 ? ' – чека прилив од банката.' : ps.s < -0.009 ? ' – примено е повеќе отколку што има картички во фискалните извештаи: проверете дали се внесени сите извештаи.' : ' ✓ затворено.'}
        </div>
      ) : null}
      {sp.posted && <div className="callout good">✓ Прокнижени {sp.posted} {sp.posted === '1' ? 'запис' : 'дневни прометa'} (вкупно {fmt(Number(sp.tot) || 0)}) во налогот „Каса“{vatReg ? ' и во ДДВ-04' : ''}.{Number(sp.iss) ? ` Направен излез на ${sp.iss} ставки – залихата е раздолжена, трошокот (набавна вредност) е прокнижен.` : ''} <Link className="btn sm" href="/nalozi">Налози →</Link></div>}
      <div className="callout">За фирми без програма: го носат извештајот од фискалниот апарат за период (на пр. 01.01 – 31.03), дневни или само вкупно. Програмата го чита, го книжи прометот (со или без ДДВ) и, по желба, прави излез на стока од продавницата до истата вредност (FIFO / LIFO / пропорционално).</div>
      {!write && <div className="callout warn">Прикачувањето документи е достапно само за корисници со право на уредување.</div>}
      {write && !aiDoc && !manualIn && (
        <>
          <FiskScan firmId={firm.id} />
          <div className="row" style={{ gap: 8, margin: '0 0 8px' }}>
            <Link className="btn" href="/fiskPer?man=1">✎ Внеси рачно (само вкупно)</Link>
            <Link className="btn" href="/fiskPer?det=1">Детален рачен внес (по ДДВ стапки, Z бр.)</Link>
            {(manual || sp.man === '1') && <Link className="btn ghost" href="/fiskPer">✕ Почни одново</Link>}
          </div>
        </>
      )}
      {read}
      {editor}
      <div className="card">
        <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Прокнижени фискални извештаи {year}</h2>
          {list.length > 0 && <div className="row noprint" style={{ gap: 6 }}><PdfButton selector="#fkList" title={`Фискални извештаи ${year}`} className="btn sm" landscape />
            <DownloadCsv name={`Fiskalni_izvestai_${year}.csv`} rows={[['Датум', 'Од', 'До', 'Z бр.', 'Објект', 'Апарат', 'Шема', 'Вкупно', 'Картичка', 'ДДВ групи'],
              ...list.map((d) => [dmy(d.date), dmy(d.fisk?.from), dmy(d.fisk?.to), d.number ?? '', L.locName(d.locationId), d.fisk?.device ?? '', d.fisk?.sc ?? '', Number(d.total), Number(d.card), d.groups.map((g) => `${g.rate}%: ${(g.base + g.vat).toFixed(2)}`).join(' · ')])]} /></div>}
        </div>
        {list.length ? (
          <div className="tw" id="fkList"><table>
            <thead><tr><th>Датум</th><th>Z бр.</th><th>Објект</th><th>Апарат</th><th>Шема</th><th className="n">Вкупно</th><th className="n">Картичка</th><th>ДДВ групи</th><th className="n">Ставки (стока)</th><th className="noprint" /></tr></thead>
            <tbody>{list.map((d) => (
              <tr key={d.id}>
                <td>{dmy(d.date)}{d.fisk?.from && d.fisk?.to && d.fisk.from !== d.fisk.to ? <span className="mini"> ({dmy(d.fisk.from)}–{dmy(d.fisk.to)})</span> : null}{d.days?.some((x) => x.est) ? <> <span className="pill warn">распр.</span></> : null}</td>
                <td>{d.number}</td><td>{L.locName(d.locationId)}</td><td className="mini">{d.fisk?.device}</td><td>{d.fisk?.sc ?? '—'}</td><td className="n">{fmt(d.total)}</td><td className="n">{fmt(d.card)}</td>
                <td className="mini">{d.groups.map((g) => `${g.rate}%: ${fmt(g.base + g.vat)}`).join(' · ')}</td><td className="n">{d.lines.length}</td>
                <td className="noprint" style={{ whiteSpace: 'nowrap' }}>{d.fisk?.fileId && <a className="btn sm ghost" href={`/api/files/${d.fisk.fileId}`} target="_blank" title="Скениран извештај">📎</a>}
                  {write && <RowAction action={deleteSalesDayAction.bind(null, d.id)} label="🗑" title="Избриши" confirm={`Да се избрише извештајот ${d.number ?? ''} од ${dmy(d.date)}?`} />}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="empty">Нема внесени фискални извештаи во {year}.</div>}
      </div>
    </>
  );
}
