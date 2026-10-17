/**
 * The three windows of „Аналитика“ (old program: Избор на конто за аналитика → комитенти на контото → картица „Аналитика“),
 * as plain server-rendered tables (`table.fit`, fits 1280px) driven by `components/key-nav.tsx`.
 */
import Link from 'next/link';
import type { CardSort } from '@wise/core/finance';
import { dmy, fmt } from '@/lib/fmt';
import { AK_MODE_LABEL, akSearchText, curRunning, groupByStatement, partnerTotals, sortCard, type AkFilter, type AkKontoRow, type AkMode, type AkPartnerRow } from '@/lib/akart';
import { KeyNav } from '@/components/key-nav';
import type { kkData } from '../kkart/data';

/** `at` = the row to select when coming back (Esc) to a list: the konto in the konto list, the partner in the partner list. */
export interface AkState { from: string; to: string; post: boolean; sort: CardSort; m: AkMode; k: string; pid: string; f: AkFilter; g: boolean; at?: string }
type O = Partial<Record<keyof AkState, string>>;

/** Query string of the screen (only the values that differ from the defaults). */
export function akQs(s: AkState, o: O = {}): string {
  const v: Record<string, string> = {
    k: s.k, pid: s.pid, from: s.from, to: s.to, post: s.post ? '' : '0', sort: s.sort === 'nal' ? 'nal' : '', m: s.m === 'd' ? '' : s.m,
    f: s.f === 'a' ? '' : s.f, g: s.g ? '1' : '', at: '', ...o,
  };
  return new URLSearchParams(Object.entries(v).filter(([, x]) => x) as [string, string][]).toString();
}
export const akHref = (s: AkState, o: O = {}) => '/akart?' + akQs(s, o);

const SaldoDP = ({ s }: { s: number }) => (Math.abs(s) < 0.005 ? <>{fmt(0)}</> : <>{fmt(Math.abs(s))}<span className="dp">{s > 0 ? 'Д' : 'П'}</span></>);
const n0 = (v: number) => (Math.abs(v) > 0.004 ? fmt(v) : '');

/* ================================================================ 1. Избор на конто за аналитика */

export function KontoStep({ s, rows }: { s: AkState; rows: readonly AkKontoRow[] }) {
  const sel = (m: AkMode) => akHref({ ...s, m }, { k: '{k}', pid: '' }).replace('%7Bk%7D', '{k}');
  return (
    <>
      <KeyNav table="akK" keys={{ F4: '#akF4', F5: '#akF5', F6: '#akF6', F7: '#akF7' }} />
      <form className="card"><div className="row" style={{ gap: '8px 14px', alignItems: 'end' }}>
        <label className="mini" id="akF6" htmlFor="akFrom" title="Промена на период (F6)">Период од <input id="akFrom" name="from" type="date" defaultValue={s.from} /></label>
        <label className="mini">до <input name="to" type="date" defaultValue={s.to} /></label>
        <label className="chk" style={{ margin: 0 }}><input type="checkbox" name="post" value="1" defaultChecked={s.post} /> Само конта со книжење</label>
        <input type="hidden" name="post" value="0" />
        <fieldset className="fs" style={{ margin: 0, padding: '2px 10px' }}><legend>Сортирање по</legend><div className="row">
          <label className="rb"><input type="radio" name="sort" value="nal" defaultChecked={s.sort === 'nal'} /> Налог</label>
          <label className="rb"><input type="radio" name="sort" value="date" defaultChecked={s.sort !== 'nal'} /> Датум</label>
        </div></fieldset>
        <button className="btn">Промена на период (F6)</button>
      </div></form>
      <div className="row" style={{ gap: 6, margin: '0 0 8px', flexWrap: 'wrap' }}>
        <button type="button" className="btn pri" data-tpl={sel('d')} title="Enter / двоен клик">ИЗБОР (Enter) денарска</button>
        <button type="button" className="btn" id="akF5" data-tpl={sel('v')}>Девизна (F5)</button>
        <button type="button" className="btn" id="akF4" data-tpl={sel('dv')}>Денарско-девизна (F4)</button>
        <button type="button" className="btn" data-tpl="/print/fin/ios?k={k}&bal=1" data-new>ИОС</button>
        <button type="button" className="btn" data-tpl="/print/fin/ios?k={k}&bal=1&cur=1" data-new>Девизен ИОС</button>
        <button type="button" className="btn" data-tpl={`/kartici?k={k}&syn=1&from=${s.from}&to=${s.to}${s.sort === 'nal' ? '&sort=nal' : ''}`}>Синтетичка картица</button>
        <button className="btn" id="akF7" form="akGrp" title="Аналитички картици за сите означени конта заедно">Групен избор (F7)</button>
      </div>
      <form id="akGrp" action="/kartici">
        <input type="hidden" name="from" value={s.from} /><input type="hidden" name="to" value={s.to} />{s.sort === 'nal' && <input type="hidden" name="sort" value="nal" />}
      </form>
      <div className="tw" style={{ maxHeight: 'calc(100vh - 330px)', minHeight: 240 }}>
        <table id="akK" className="fit knav">
          <thead><tr><th style={{ width: 28 }} /><th style={{ width: 90 }}>Конто</th><th>Назив</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th></tr></thead>
          <tbody>{rows.length ? rows.map((r) => (
            <tr key={r.c} data-href={akHref(s, { k: r.c, pid: '', m: '' })} data-k={r.c} data-s={akSearchText(r.c, r.n)} {...(r.c === s.at ? { 'data-sel': '' } : {})}>
              <td><input type="checkbox" name="k" value={r.c} form="akGrp" aria-label={`Групен избор ${r.c}`} /></td>
              <td><Link href={akHref(s, { k: r.c, pid: '', m: '' })}><b>{r.c}</b></Link></td>
              <td className="w">{r.n}</td>
              <td className="n">{n0(r.d)}</td><td className="n">{n0(r.p)}</td><td className="n">{r.d || r.p ? <SaldoDP s={r.d - r.p} /> : ''}</td>
            </tr>
          )) : <tr><td colSpan={6} className="empty">Нема конта.</td></tr>}</tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 8, alignItems: 'center' }}>
        <input data-keynav="" data-filter="" autoFocus placeholder="🔍 Конто (на пр. 2200) или назив – ↑ ↓ Enter" style={{ width: 340 }} autoComplete="off" aria-label="Барај конто" />
        <span className="mini">↑ ↓ избор · Enter / двоен клик = денарска · F5 девизна · F4 денарско-девизна · F6 период · F7 групен избор (☑)</span>
      </div>
    </>
  );
}

/* ================================================================ 2. Комитенти на контото */

const FLT: [AkFilter, string][] = [['a', 'Активни (со салдо)'], ['p', 'Пасивни (салдо 0)'], ['s', 'Сите']];

export function PartnerStep({ s, kName, rows }: { s: AkState; kName: string; rows: readonly AkPartnerRow[] }) {
  const T = partnerTotals(rows);
  const hasExtra = rows.some((r) => r.extra), hasBank = rows.some((r) => r.bank);
  const cols = 10 + (hasExtra ? 1 : 0) + (hasBank ? 1 : 0);
  return (
    <>
      <KeyNav table="akP" digitsInText keys={{ Escape: akHref(s, { k: '', pid: '', f: '', at: s.k }) }} />
      <div className="row" style={{ gap: 6, margin: '0 0 8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {FLT.map(([f, t]) => <Link key={f} className={`btn sm${s.f === f ? ' pri' : ''}`} href={akHref(s, { f, pid: '' })}>{t}</Link>)}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm pri" data-tpl={akHref(s, { pid: '{id}' }).replace('%7Bid%7D', '{id}')}>Картица (Enter)</button>
        <button type="button" className="btn sm" data-tpl="/print/fin/ios?pid={id}" data-new>ИОС</button>
        <button type="button" className="btn sm" data-tpl="/print/fin/ios?pid={id}&cur=1" data-new>Девизен ИОС</button>
        <Link className="btn sm" href={akHref(s, { k: '', pid: '', f: '', at: s.k })}>Излез (Esc)</Link>
      </div>
      <div className="tw" style={{ maxHeight: 'calc(100vh - 300px)', minHeight: 240 }}>
        <table id="akP" className="fit knav">
          <thead><tr>
            <th>Шифра</th><th>Име</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th>
            <th className="n">Доспеан износ</th><th className="n" title="Денови доцнење на најстарата доспеана ставка">Доцни ден.</th><th className="n">Салдо ПС</th>
            {hasExtra && <th>Дополнителен назив</th>}{hasBank && <th>Жиро с-ка</th>}<th>Град</th><th>ЕДБ / ЕМБС</th><th>Адреса</th>
          </tr></thead>
          <tbody>{rows.length ? rows.map((r) => (
            <tr key={r.id} data-href={akHref(s, { pid: r.id })} data-id={r.id} data-k={r.code} data-s={akSearchText(r.code, r.name, r.ids, r.city, r.extra)} {...(r.id === s.at ? { 'data-sel': '' } : {})}>
              <td style={{ whiteSpace: 'nowrap' }}>{r.code}</td>
              <td className="w"><Link href={akHref(s, { pid: r.id })}>{r.name}</Link></td>
              <td className="n">{fmt(r.d)}</td><td className="n">{fmt(r.p)}</td><td className="n"><b>{fmt(r.s)}</b></td>
              <td className="n" style={r.over > 0 ? { color: 'var(--bad)' } : undefined}>{n0(r.over)}</td>
              <td className="n">{r.late > 0 ? r.late : ''}</td><td className="n">{n0(r.ps)}</td>
              {hasExtra && <td className="w"><small>{r.extra}</small></td>}{hasBank && <td style={{ whiteSpace: 'nowrap' }}><small>{r.bank}</small></td>}
              <td className="w"><small>{r.city}</small></td><td style={{ whiteSpace: 'nowrap' }}><small>{r.ids}</small></td><td className="w" style={{ maxWidth: 200 }}><small>{r.address}</small></td>
            </tr>
          )) : <tr><td colSpan={cols + 1} className="empty">Нема комитенти за избраниот филтер.</td></tr>}</tbody>
          <tfoot><tr><td colSpan={2}>Вкупно {rows.length}</td><td className="n">{fmt(T.d)}</td><td className="n">{fmt(T.p)}</td><td className="n">{fmt(T.s)}</td><td className="n">{n0(T.over)}</td><td /><td className="n">{n0(T.ps)}</td><td colSpan={cols - 7} /></tr></tfoot>
        </table>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 8, alignItems: 'center' }}>
        <input data-keynav="" data-filter="" autoFocus placeholder="🔍 Шифра, име, ЕДБ, град – ↑ ↓ Enter" style={{ width: 320 }} autoComplete="off" aria-label="Барај комитент" />
        <span className="mini">Конто {s.k} {kName} · Enter / двоен клик = картица · Esc = избор на конто · доспеано на {dmy(s.to)}</span>
      </div>
    </>
  );
}

/* ================================================================ 3. Картица „Аналитика“ */

type D = Awaited<ReturnType<typeof kkData>>;
type Nb = { id: string; name: string } | null;

export function CardStep({ s, d, firmName, partner, prev, next, pos }: {
  s: AkState; d: D; firmName: string;
  partner: { code: string; name: string; bank: string } | null;
  prev: Nb; next: Nb; pos?: { i: number; n: number };
}) {
  const { X } = d;
  const sorted = sortCard(X.rows, X.opening, s.sort);
  const rows = s.g ? groupByStatement(sorted) : sorted.map((r) => ({ ...r, n: 0 }));
  const E = rows.map((r) => d.ext(r.line));
  const cur = curRunning(rows.map((r, i) => ({ ...r.line, currency: E[i]!.currency, amountCur: r.n > 1 ? null : E[i]!.amountCur })));
  const den = s.m !== 'v', dev = s.m !== 'd';
  const note = (r: (typeof rows)[number]) => (r.line.note && r.line.note !== r.line.description ? r.line.note : '').slice(0, 120);
  const hasNote = rows.some((r) => note(r));
  const showPartner = !partner && E.some((e) => e.partner);
  const hasDue = E.some((e) => e.due), hasDdoc = E.some((e) => e.ddoc && e.ddoc !== '');
  const exit = partner ? akHref(s, { pid: '', g: '', m: '', at: s.pid }) : akHref(s, { k: '', pid: '', f: '', g: '', m: '', at: s.k });
  const print = `/print/kkart?${new URLSearchParams({ k: d.k, sub: '1', ...(partner ? { p: s.pid } : {}), from: d.from, to: d.to }).toString()}`;
  const keys: Record<string, string> = { Escape: exit, F2: print, F3: '#akF3' };
  if (prev) keys.F4 = akHref(s, { pid: prev.id });
  if (next) keys.F5 = akHref(s, { pid: next.id });
  const lead = 3;
  const tail = (hasNote ? 1 : 0) + (showPartner ? 1 : 0) + (hasDue ? 1 : 0) + (hasDdoc ? 1 : 0);
  return (
    <>
      <KeyNav table="akC" keys={keys} />
      <div className="card" style={{ padding: '8px 12px', marginBottom: 8 }}>
        <div className="row" style={{ gap: '4px 22px', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="mini">{firmName}</span>
          <span>Конто <b>{d.k}</b> {d.name}</span>
          {partner && <span>Комитент <b>{partner.code}</b> {partner.name}{pos && <span className="mini"> ({pos.i + 1} / {pos.n})</span>}</span>}
          {partner?.bank && <span className="mini">Жиро {partner.bank}</span>}
          <span className="mini">{dmy(d.from)} – {dmy(d.to)} · {AK_MODE_LABEL[s.m]} · по {s.sort === 'nal' ? 'налог' : 'датум'}</span>
        </div>
      </div>
      <div className="row" style={{ gap: 6, margin: '0 0 8px', flexWrap: 'wrap' }}>
        {partner && <>{prev ? <Link className="btn sm" href={keys.F4!} title={prev.name}>← Претх. комит. (F4)</Link> : <span className="btn sm disabled">← Претх. комит. (F4)</span>}
          {next ? <Link className="btn sm" href={keys.F5!} title={next.name}>Следен комит. (F5) →</Link> : <span className="btn sm disabled">Следен комит. (F5) →</span>}</>}
        <Link className={`btn sm${s.g ? ' pri' : ''}`} href={akHref(s, { g: s.g ? '' : '1' })}>Групно по изводи</Link>
        <a className="btn sm" href={print} target="_blank" rel="noopener">Печатење (F2)</a>
        <button type="button" className="btn sm" id="akF3" data-tpl="/nalozi?n={k}">Преглед на содржина (F3)</button>
        {(['d', 'v', 'dv'] as const).map((m) => <Link key={m} className={`btn sm${s.m === m ? ' pri' : ''}`} href={akHref(s, { m: m === 'd' ? '' : m })}>{AK_MODE_LABEL[m]}</Link>)}
        <span style={{ flex: 1 }} />
        <Link className="btn sm" href={exit}>Излез (Esc)</Link>
      </div>
      <div className="tw" style={{ maxHeight: 'calc(100vh - 330px)', minHeight: 240 }}>
        <table id="akC" className="dense fit knav">
          <thead><tr>
            <th title="Налог / реден број во налогот">Налог / р.бр.</th><th>Датум книж. <span style={{ fontWeight: 400 }}>(налог)</span></th><th>Содржина / фак. бр. · документ</th>
            {den && <><th className="n">Должи</th><th className="n">Побарува</th><th className="n" title="Д = салдо должи, П = салдо побарува">Салдо Д / П</th></>}
            {dev && <><th>Вал.</th><th className="n">Дев. износ</th><th className="n">Дев. салдо</th></>}
            {hasNote && <th>Забелешка</th>}{showPartner && <th>Ком.ш. · комитент</th>}{hasDue && <th>Датум на валута</th>}{hasDdoc && <th>Датум на док.</th>}
          </tr></thead>
          <tbody>
            <tr><td /><td style={{ whiteSpace: 'nowrap' }}>{dmy(d.from)}</td><td><i>ПОЧЕТНО САЛДО / ПРЕНОС</i></td>
              {den && <><td className="n">{X.opening > 0 ? fmt(X.opening) : ''}</td><td className="n">{X.opening < 0 ? fmt(-X.opening) : ''}</td><td className="n"><SaldoDP s={X.opening} /></td></>}
              {dev && <td colSpan={3} />}{tail > 0 && <td colSpan={tail} />}</tr>
            {rows.map((r, i) => {
              const e = E[i]!, c = cur[i]!;
              const ld = dmy(r.line.date), nd = e.nd ? dmy(e.nd) : '';
              const num = r.line.number ?? '';
              const docTxt = [e.calc ? 'калк. ' + e.calc : '', r.line.doc && !e.sod.includes(String(r.line.doc).toUpperCase()) ? r.line.doc : ''].filter(Boolean).join(' · ');
              return (
                <tr key={i} data-href={`/nalozi?n=${encodeURIComponent(num)}`} data-k={num}>
                  <td style={{ whiteSpace: 'nowrap' }}><b>{num}</b>{e.rb !== '' && r.n <= 1 && <span className="mini"> / {e.rb}</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{ld}{nd && nd !== ld && <span className="sub2" title="Налог датум">нал. {nd}</span>}</td>
                  <td className="w"><b>{e.sod}</b>{r.n > 1 && <span className="mini"> ({r.n} ставки)</span>}{docTxt && <span className="sub2">{docTxt}</span>}</td>
                  {den && <><td className="n">{n0(r.line.debit)}</td><td className="n">{n0(r.line.credit)}</td><td className="n"><SaldoDP s={r.balance} /></td></>}
                  {dev && <><td>{c.cur}</td><td className="n">{c.amt == null ? '' : fmt(c.amt)}</td><td className="n">{c.s == null ? '' : fmt(c.s)}</td></>}
                  {hasNote && <td className="w" style={{ maxWidth: 200 }}><small>{note(r)}</small></td>}
                  {showPartner && <td className="w" style={{ maxWidth: 220 }}><small>{e.partner}</small></td>}
                  {hasDue && <td style={{ whiteSpace: 'nowrap' }}>{e.due ? dmy(e.due) : ''}</td>}
                  {hasDdoc && <td style={{ whiteSpace: 'nowrap' }}>{e.ddoc ? dmy(e.ddoc) : ''}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td colSpan={lead}>Вк. сума должи / побарува / салдо</td>
              {den && <><td className="n">{fmt(X.debit + (X.opening > 0 ? X.opening : 0))}</td><td className="n">{fmt(X.credit + (X.opening < 0 ? -X.opening : 0))}</td><td className="n"><b><SaldoDP s={X.closing} /></b></td></>}
              {(dev ? 3 : 0) + tail > 0 && <td colSpan={(dev ? 3 : 0) + tail} />}</tr>
          </tfoot>
        </table>
      </div>
      <p className="mini" style={{ marginTop: 6 }}>↑ ↓ избор · Enter / F3 / двоен клик = налогот на ставката · {partner ? 'F4 / F5 претходен / следен комитент · ' : ''}F2 печатење · Esc излез</p>
    </>
  );
}

/** Excel of the card: all the old program's columns. */
export function cardRows(d: D, partner: { code: string; name: string } | null): (string | number)[][] {
  const { X } = d;
  return [
    ['Р.бр. во налог', 'Налог', 'Налог датум', 'Датум книж.', 'Содржина/фак.бр.', 'Документ', 'Должи', 'Побарува', 'Салдо должи', 'Салдо побар.', 'Забелешка', 'Ком.ш.', 'Комитент', 'Датум на валута', 'Датум на док.', 'Валута', 'Девизен износ'],
    ['', '', '', dmy(d.from), 'ПОЧЕТНО САЛДО', '', X.opening > 0 ? X.opening : 0, X.opening < 0 ? -X.opening : 0, X.opening > 0 ? X.opening : 0, X.opening < 0 ? -X.opening : 0, '', partner?.code ?? '', partner?.name ?? '', '', '', '', ''],
    ...X.rows.map((r) => {
      const e = d.ext(r.line);
      return [e.rb, r.line.number ?? '', e.nd ? dmy(e.nd) : '', dmy(r.line.date), e.sod, [e.calc, r.line.doc].filter(Boolean).join(' / '), r.line.debit, r.line.credit,
        r.balance >= 0 ? r.balance : 0, r.balance < 0 ? -r.balance : 0, r.line.note ?? '', e.pcode, e.partner, e.due ? dmy(e.due) : '', e.ddoc ? dmy(e.ddoc) : '', e.currency, e.amountCur ?? ''];
    }),
    ['', '', '', '', 'Вк. сума', '', X.debit + (X.opening > 0 ? X.opening : 0), X.credit + (X.opening < 0 ? -X.opening : 0), X.closing > 0 ? X.closing : 0, X.closing < 0 ? -X.closing : 0, '', '', '', '', '', '', ''],
  ];
}
