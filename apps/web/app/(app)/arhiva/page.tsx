/**
 * Архива на документи — legacy `VIEWS.arhiva` 6606 + patch 12783: every document of the firm with attached files
 * (`archRows`), filters (text, Вид, Од, До) in the working year, columns Датум · Вид · Број · Комитент · Износ ·
 * Налог · Документи, „Отвори“ / 🗑, „Листа (Excel)“, the scan / upload card with „🗂 Досие на фирмата“.
 * Server additions: PDF of the list; 👁 in-page preview of every file (open in a new window / download from there);
 * files attached to nothing („Датотека“) can be deleted (🗑, `del`) or moved to another firm (⇄, `write` on both),
 * one by one or ticked in bulk.
 */
import Link from 'next/link';
import { can } from '@wise/core';
import { ARCH_BOOKS_YEARS, ARCH_DOC_YEARS, REG_BOOKS, archFileLabel, archFilter, archKeepUntil, archKinds, delovodnik, type RegBook } from '@wise/core/office/archive';
import { PrintBtn } from '../skan/proverka/print-btn';
import { bankAccounts, firmNalogSettings } from '@wise/db';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { nalogTitler } from '@/lib/nalog-title';
import { ArSendBar } from './send-bar';
import { requireUser } from '@/lib/auth';
import { archRows, nalogDocs, registerRows } from '@/lib/archive';
import { currentFirm, currentYear } from '@/lib/context';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { FilePreview } from '@/components/file-preview';
import { RowAction } from '@/components/row-action';
import { SelAll, SelBox } from '@/components/sales/bulk-select';
import { allowedFirms } from '@/lib/office';
import { arDel, arFileDel, arFileMove } from './actions';
import { ArBulk, ArMoveOne } from './file-tools';

type SP = { q?: string; kind?: string; from?: string; to?: string; v?: string; nal?: string; b?: string };
/** Order of the nalozi: by the start of the period, then the number. */
const nalKey = (no: string, from: string) => `${from}|${no.padStart(12, ' ')}`;

export default async function ArhivaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const firm = await currentFirm(u);
  if (!firm) return <><Hd t="Архива на документи" /><div className="callout">Изберете фирма со <b>⇄ Промени фирма</b>.</div></>;
  const year = await currentYear();
  const all = await archRows(firm.id);
  const f = { q: (sp.q ?? '').trim(), kind: sp.kind ?? '', from: sp.from ?? '', to: sp.to ?? '', year };
  // „по налог“ (default): the nalozi of the year, each opened alone; „сите“: the whole list as before
  const view = sp.v === 'reg' ? 'reg' : sp.v === 'list' || f.q || f.kind || f.from || f.to ? 'list' : 'nalog';
  // деловодник: every document of the year under its serial number per book (примени / испратени / други)
  const REG = view === 'reg' ? delovodnik(await registerRows(firm.id, year), year) : [];
  const book = (['in', 'out', 'other'] as const).find((b) => b === sp.b) as RegBook | undefined;
  const regN = (b: RegBook) => REG.filter((r) => r.book === b).length;
  const N = await nalogDocs(firm.id, year);
  // the nalog's name as everywhere (✎ Назив, ВЛЕЗНИ ФАКТУРИ / ИЗВОДИ <банка> …), not its first document
  const banks = await db().select({ id: bankAccounts.id, name: bankAccounts.name }).from(bankAccounts).where(eq(bankAccounts.firmId, firm.id));
  const TT = nalogTitler({ settings: firm.settings, year, nal: firmNalogSettings(firm), banks });
  const titles = Object.fromEntries([...N.entries()].map(([no, g]) => [no, TT.title({ no, journals: g.journals })])) as Record<string, string>;
  const R0 = archFilter(all, f);
  const FOLDERS = { arch: 'archived', pend: 'pending', bank: 'bank', ob: 'opening' } as const;
  const fk = sp.nal?.startsWith('@') ? FOLDERS[sp.nal.slice(1) as keyof typeof FOLDERS] : undefined;
  const R = fk ? R0.filter((r) => r.folder === fk) : sp.nal === '-' ? R0.filter((r) => !r.nalog && !r.loose && !r.folder) : sp.nal === '~' ? R0.filter((r) => r.loose) : sp.nal ? R0.filter((r) => r.nalog === sp.nal) : R0;
  const withFile = new Set(all.filter((r) => r.files.length).map((r) => r.key));
  const missing = sp.nal && N.get(sp.nal) ? N.get(sp.nal)!.docs.filter((d) => !withFile.has(d.key)) : [];
  const nalList = [...N.entries()].map(([no, g]) => {
    const docs = new Set(g.docs.map((d) => d.key));
    const files = all.filter((r) => r.nalog === no && r.files.length).reduce((a, r) => a + r.files.length, 0);
    return { no, ...g, title: titles[no] ?? g.desc, n: docs.size, files, without: [...docs].filter((k) => !withFile.has(k)).length };
  }).sort((a, b) => nalKey(a.no, a.from).localeCompare(nalKey(b.no, b.from)));
  const yr = all.filter((r) => !r.date || r.date.slice(0, 4) === String(year));
  const noNal = yr.filter((r) => !r.nalog && !r.loose && !r.folder).length, looseN = yr.filter((r) => r.loose).length;
  const fn = (k: string) => yr.filter((r) => r.folder === k).length;
  const kinds = archKinds(all, year);
  const nf = R.reduce((a, r) => a + r.files.length, 0);
  const del = can(u.principal, 'del', firm.id);
  const write = can(u.principal, 'write', firm.id);
  const moveTo = write ? (await allowedFirms(u, { year: 'all' })).filter((x) => x.id !== firm.id && can(u.principal, 'write', x.id)).map((x) => ({ id: x.id, name: x.name })) : [];
  const loose = R.filter((r) => r.loose);
  const tools = loose.length > 0 && (del || moveTo.length > 0);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])).toString();
  return (
    <>
      <Hd t="Архива на документи" sub={`${nf} датотеки · ${year}`}>
        <a className="btn" href={`/arhiva/xlsx?${qs}`}>Листа (Excel)</a>
      </Hd>
      {can(u.principal, 'write', firm.id) && (
        <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link className="btn pri" href="/arNewNav">📷 Скенирај / прикачи нов документ</Link>
          <span className="note" style={{ margin: 0 }}>Секој документ што ќе го архивирате (договор, решение, потврда, писмо, сертификат…) се зачувува во <b>досието на фирмата</b> по вид – со рок „Важи до“, праќање по Gmail / WhatsApp и преземање.</span>
          <span style={{ flex: 1 }} />
          <Link className="btn" href="/dosie">🗂 Досие на фирмата</Link>
        </div>
      )}
      <div className="callout info"><b>⚖ Рокови на чување:</b> фактури и другите документи – најмалку <b>{ARCH_DOC_YEARS} години</b> по истекот на календарската година (ЗДДВ чл. 56 ст. 1, ЗДП чл. 48 ст. 1); деловни книги и евиденции (налози, дневник, главна книга) – <b>{ARCH_BOOKS_YEARS} години</b> (ЗДП чл. 48 ст. 1). Електронските фактури се чуваат во формата во која се издадени / примени, автентични, интегрални и читливи (ЗДДВ чл. 56 ст. 2–3). Рокот тече од крајот на годината на последното запишување (ЗДП чл. 48 ст. 2).</div>
      <div className="row noprint" style={{ gap: 6, margin: '0 0 8px', flexWrap: 'wrap' }}>
        <Link className={`btn ${view === 'nalog' && !sp.nal ? 'pri' : ''}`} href="/arhiva">По налог</Link>
        <Link className={`btn ${view === 'list' && !sp.nal ? 'pri' : ''}`} href="/arhiva?v=list">Сите документи</Link>
        <Link className={`btn ${view === 'reg' ? 'pri' : ''}`} href="/arhiva?v=reg">📒 Деловодник (реден број)</Link>
        <Link className={`btn ${sp.nal === '-' ? 'pri' : ''}`} href="/arhiva?nal=-">Без налог (досие, вработени…) · {noNal}</Link>
        <Link className={`btn ${sp.nal === '@arch' ? 'pri' : ''}`} href="/arhiva?nal=@arch">📁 Архивирани (не се книжат) · {fn('archived')}</Link>
        {fn('pending') > 0 && <Link className={`btn ${sp.nal === '@pend' ? 'pri' : ''}`} href="/arhiva?nal=@pend">⏳ Чека одобрување · {fn('pending')}</Link>}
        {fn('bank') > 0 && <Link className={`btn ${sp.nal === '@bank' ? 'pri' : ''}`} href="/arhiva?nal=@bank">⚠ Изводи – не се увезени · {fn('bank')}</Link>}
        {fn('opening') > 0 && <Link className={`btn ${sp.nal === '@ob' ? 'pri' : ''}`} href="/arhiva?nal=@ob">Почетна состојба · {fn('opening')}</Link>}
        <Link className={`btn ${sp.nal === '~' ? 'pri' : ''}`} href="/arhiva?nal=~">Неповрзани датотеки · {looseN}</Link>
      </div>
      {sp.nal === '@arch' && <div className="callout">📁 Документи што сте ги прегледале и <b>не се книжат</b> (откажани, работни налози, празни страници…) – по месеци. Остануваат во архивата.</div>}
      {sp.nal === '@bank' && <div className="callout warn">⚠ Изводи што се прочитани, но <b>не се во книгите</b> (изводот е избришан). Увезете ги повторно во <Link href="/banka">Банка</Link> – истите PDF, читањето се користи повторно без AI; датотеката се поврзува сама.</div>}
      {view === 'reg' && (
        <div className="tw card">
          <div className="hd"><h2 style={{ margin: 0 }}>Деловодник {year} – {firm.name}</h2><PrintBtn /></div>
          <div className="callout info noprint">📒 Секој документ на фирмата е заведен <b>еднаш, под реден број</b> во својата книга: <b>01</b> – примени (влезни фактури, фискални сметки, изводи, увозни документи), <b>02</b> – испратени (излезни фактури, одобренија, испратници, профактури), <b>03</b> – други / внатрешни (договори, решенија, досие, вработени…). Бројот е <b>книга-реден број/година</b> (пр. 01-15/{String(year).slice(2)}), по датумот на документот, од 1 секоја година (Уредба за канцелариско и архивско работење). Документите се чуваат најмалку {ARCH_DOC_YEARS} години, деловните книги {ARCH_BOOKS_YEARS} (ЗДП чл. 48, ЗДДВ чл. 56).</div>
          <div className="row noprint" style={{ gap: 6, margin: '0 0 8px', flexWrap: 'wrap' }}>
            <Link className={`btn sm ${!book ? 'pri' : ''}`} href="/arhiva?v=reg">Сите · {REG.length}</Link>
            {(['in', 'out', 'other'] as const).map((b) => <Link key={b} className={`btn sm ${book === b ? 'pri' : ''}`} href={`/arhiva?v=reg&b=${b}`}>{REG_BOOKS[b]} · {regN(b)}</Link>)}
          </div>
          <table className="dense">
            <thead><tr><th>Реден бр.</th><th>Датум</th><th>Книга</th><th>Вид</th><th>Број на документот</th><th>Испраќач / примач</th><th className="n">Износ</th><th>Налог</th><th>Датотека</th><th>Чувај до</th></tr></thead>
            <tbody>{REG.filter((r) => !book || r.book === book).map((r) => (
              <tr key={r.key}>
                <td><b>{r.regNo}</b></td><td>{dmy(r.date)}</td><td className="mini">{REG_BOOKS[r.book].slice(5)}</td>
                <td>{r.href ? <Link href={r.href}>{r.kind}</Link> : r.kind}</td><td>{r.no}</td><td>{r.pn}</td>
                <td className="n">{r.amt != null ? fmt(r.amt) : ''}</td><td>{r.nalog ?? ''}</td>
                <td>{r.files.length ? <span className="row" style={{ gap: 4 }}>{r.files.map((x) => <FilePreview key={x.id} id={x.id} name={x.name} mime={x.mime} label="👁" title={`Преглед: ${x.name}`} />)}</span> : <span className="pill warn" title="Нема скениран / прикачен документ">нема</span>}</td>
                <td className="mini">{archKeepUntil(r) ? dmy(archKeepUntil(r)!) : ''}</td>
              </tr>
            ))}</tbody>
          </table>
          {!REG.length && <p className="empty">Нема документи во {year}.</p>}
        </div>
      )}
      {view === 'nalog' && !sp.nal && (
        <div className="tw card">
          <h2 style={{ marginTop: 0 }}>Налози {year} – документи и датотеки</h2>
          <table className="dense">
            <thead><tr><th>Налог</th><th>Назив</th><th>Период</th><th className="n">Документи</th><th className="n">Датотеки</th><th className="n">Без датотека</th><th>Чувај до</th><th /></tr></thead>
            <tbody>{nalList.map((g) => (
              <tr key={g.no}>
                <td><Link href={`/arhiva?nal=${encodeURIComponent(g.no)}`}><b>{g.no}</b></Link></td>
                <td>{g.title}</td><td className="mini">{dmy(g.from)} – {dmy(g.to)}</td>
                <td className="n">{g.n}</td><td className="n">{g.files}</td>
                <td className="n">{g.without ? <span className="pill warn">{g.without}</span> : g.n ? <span className="pill good">✓</span> : ''}</td>
                <td className="mini">{`31.12.${year + ARCH_BOOKS_YEARS}`}</td>
                <td><Link className="btn sm" href={`/arhiva?nal=${encodeURIComponent(g.no)}`}>Отвори</Link></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="note">„Без датотека“ = документи книжени во налогот што немаат прикачен / скениран документ. Налогот (деловна книга) се чува {ARCH_BOOKS_YEARS} години, документите во него – {ARCH_DOC_YEARS}.</p>
        </div>
      )}
      {sp.nal && sp.nal !== '-' && sp.nal !== '~' && (
        <div className="card">
          <div className="hd"><h2 style={{ margin: 0 }}>Налог {sp.nal}{titles[sp.nal] || N.get(sp.nal)?.desc ? ' – ' + (titles[sp.nal] ?? N.get(sp.nal)!.desc) : ''}</h2>
            <span className="row" style={{ gap: 6 }}><Link className="btn sm" href={`/nalozi?n=${encodeURIComponent(sp.nal)}`}>Отвори го налогот</Link><Link className="btn sm" href="/arhiva">← Сите налози</Link></span></div>
          {missing.length > 0 ? (
            <div className="callout warn"><b>{missing.length} документи без датотека</b> (книжени, но без скениран документ):
              <ul style={{ margin: '4px 0 0' }}>{missing.slice(0, 50).map((d) => <li key={d.key}>{dmy(d.date)} · {d.href ? <Link href={d.href}>{d.label}</Link> : d.label}</li>)}</ul></div>
          ) : <div className="callout good">✓ Сите документи во налогот имаат датотека.</div>}
        </div>
      )}
      {(view === 'list' || sp.nal) && <form className="card">
        <div className="row" style={{ gap: '10px 16px', alignItems: 'end' }}>
          <input name="q" placeholder="Барај број, комитент, име на датотека…" defaultValue={f.q} style={{ width: 280 }} />
          <label className="mini">Вид <select name="kind" defaultValue={f.kind} style={{ width: 'auto' }}><option value="">сите</option>{kinds.map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="mini">Од <input name="from" type="date" defaultValue={f.from} /></label>
          <label className="mini">До <input name="to" type="date" defaultValue={f.to} /></label>
          <button className="btn">Барај</button>
        </div>
      </form>}
      {(view === 'list' || sp.nal) && R.length > 0 && <ArSendBar firm={firm.name} />}
      {(view === 'list' || sp.nal) && (R.length ? (
        <div className="tw" id="arList">
          {tools && <ArBulk firms={moveTo} del={del ? arFileDel : undefined} move={moveTo.length ? arFileMove : undefined} />}
          <table>
            <thead><tr><th title="Избери за преземање / печатење / праќање">✓</th>{tools && <th><SelAll group="ar" /></th>}<th>Датум</th><th>Вид</th><th>Број</th><th>Комитент</th><th className="n">Износ</th><th>Налог</th><th>Документи</th><th>Чувај до</th><th></th></tr></thead>
            <tbody>
              {R.map((r) => (
                <tr key={r.key}>
                  <td><input type="checkbox" value={r.files.map((x) => x.id).join(',')} data-arsel={[r.kind, r.no, r.pn, r.date ? dmy(r.date) : ''].filter(Boolean).join(' · ')} aria-label="Избери" /></td>
                  {tools && <td>{r.loose && <SelBox id={r.files[0]!.id} group="ar" />}</td>}
                  <td>{r.date ? dmy(r.date) : ''}</td><td>{r.kind}{r.note && <div className="mini">{r.note}</div>}</td><td>{r.no}</td><td>{r.pn}</td>
                  <td className="n">{r.amt != null ? fmt(r.amt) : ''}</td>
                  <td>{r.nalog && <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(r.nalog)}`}>{r.nalog}</Link>}</td>
                  <td><div className="row" style={{ gap: 4 }}>{r.files.map((x) => <FilePreview key={x.id} id={x.id} name={x.name} mime={x.mime} label={<>👁 {archFileLabel(x)}</>} title={`Преглед: ${x.name}`} />)}</div></td>
                  <td className="mini">{archKeepUntil(r) ? dmy(archKeepUntil(r)!) : ''}</td>
                  <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    {r.href && <Link className="btn sm" href={r.href}>Отвори</Link>}
                    {r.archId && del && <RowAction action={arDel.bind(null, r.archId)} label="🗑" title="Избриши од архивата" confirm={`Да се избрише документот „${r.kind} ${r.no}“ од архивата?`} />}
                    {r.files.length === 1 && <a className="btn sm ghost" href={`/api/files/${r.files[0]!.id}?dl=1`} title="Преземи">⬇</a>}
                    {r.loose && moveTo.length > 0 && <ArMoveOne id={r.files[0]!.id} name={r.files[0]!.name} firms={moveTo} move={arFileMove} />}
                    {r.loose && del && <RowAction action={arFileDel.bind(null, [r.files[0]!.id])} label="🗑" title="Избриши ја датотеката" confirm={`Да се избрише датотеката „${r.files[0]!.name}“? Ова не може да се врати.`} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="card empty">Нема архивирани документи за избраните услови. Секој скениран или прикачен документ (фактура, фискална сметка, увозни документи, изводи) автоматски се чува тука.</div>)}
      <p className="note">Документите се чуваат трајно во програмот, прикачени на фактурата или изводот. Кликнете на документот за преглед; од прегледот може да се отвори во нов прозорец или да се преземе.</p>
    </>
  );
}
