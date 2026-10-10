/**
 * Legacy `VIEWS.nalozi` 6392 — Финансово › Налози за книжење:
 * list (`nalListHTML` 6388), one nalog (`nalPage` 3573 / `nalogHTML` 3552), manual editor (`jEditor`), line search.
 */
import Link from 'next/link';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { groupNalozi, lineTotals, NAL_DEF, nalCode, type NalDefKey } from '@wise/core';
import { effectiveChart, firmNalogSettings, journalLines, journals, partners } from '@wise/db';
import { booksPage, canDo, partnerOptions, yearRange } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { DownloadCsv } from '@/components/download-csv';
import { deleteJournalAction, saveNalogSettings, setLockDate } from './actions';
import { JournalEditor } from './journal-editor';
import { newJournal, type EditorJournal } from './editor-model';

type SP = { n?: string; nov?: string; edit?: string; q?: string; cfg?: string };

export default async function NaloziPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('nalozi');
  if (!firm) return <NoFirm t="Налози за книжење" />;
  const { from, to } = yearRange(year);
  const inYear = and(eq(journals.firmId, firm.id), sql`${journals.date} between ${from} and ${to}`);

  /* ---------- editor ---------- */
  if (sp.nov !== undefined || sp.edit) {
    let initial: EditorJournal = newJournal(new Date().toISOString().slice(0, 10).startsWith(String(year)) ? new Date().toISOString().slice(0, 10) : `${year}-12-31`);
    if (sp.edit) {
      const [j] = await db().select().from(journals).where(and(eq(journals.id, sp.edit), eq(journals.firmId, firm.id))).limit(1);
      if (!j) return <NoFirm t="Налогот не постои" />;
      const L = await db().select().from(journalLines).where(eq(journalLines.journalId, j.id)).orderBy(asc(journalLines.lineNo));
      initial = {
        id: j.id, number: j.number, date: j.date, description: j.description ?? '', periodFrom: j.periodFrom ?? '', periodTo: j.periodTo ?? '',
        // An opened nalog without amounts keeps its konto rows in `meta.rows`.
        rows: L.length
          ? L.map((l) => ({ account: l.account, partnerId: l.partnerId ?? '', debit: Number(l.debit) ? String(Number(l.debit)) : '', credit: Number(l.credit) ? String(Number(l.credit)) : '', note: l.note ?? '', doc: l.doc ?? '' }))
          : ((j.meta as { rows?: { account: string; partnerId: string | null; note: string; doc: string }[] }).rows ?? []).map((r) => ({ account: r.account, partnerId: r.partnerId ?? '', debit: '', credit: '', note: r.note ?? '', doc: r.doc ?? '' })),
      };
    }
    const [chart, P, nums] = await Promise.all([
      effectiveChart(db(), firm.id), partnerOptions(firm.id),
      db().selectDistinct({ n: journals.number }).from(journals).where(inYear).limit(300),
    ]);
    return <JournalEditor initial={initial} chart={chart.map((a) => [a.code, a.name])} partners={P} numbers={nums.map((x) => x.n)} />;
  }

  /* ---------- journals of the year ---------- */
  const J = await db().select({
    id: journals.id, date: journals.date, kind: journals.kind, number: journals.number, description: journals.description,
    sourceType: journals.sourceType, periodFrom: journals.periodFrom, periodTo: journals.periodTo, locked: journals.locked,
    D: sql<string>`coalesce(sum(${journalLines.debit}), 0)`, P: sql<string>`coalesce(sum(${journalLines.credit}), 0)`, n: sql<number>`count(${journalLines.id})::int`,
  }).from(journals).leftJoin(journalLines, eq(journalLines.journalId, journals.id)).where(inYear)
    .groupBy(journals.id).orderBy(asc(journals.date), asc(journals.createdAt));
  const G = groupNalozi(J);
  const write = canDo(u, 'write', firm.id), fix = canDo(u, 'nalEdit', firm.id), del = canDo(u, 'nalDel', firm.id);
  const editable = (j: (typeof J)[number]) => !j.sourceType || ['opening', 'bbimp', 'yearClose'].includes(j.sourceType);
  const canEdit = (j: (typeof J)[number]) => editable(j) && (j.kind === 'manual' ? write : fix) && !j.locked && !(firm.lockDate && j.date <= firm.lockDate);

  /* ---------- one nalog ---------- */
  if (sp.n) {
    const gi = G.findIndex((g) => g.no === sp.n);
    const g = G[gi];
    if (!g) return <><Hd t="Налог за книжење" /><div className="card empty">Налогот {sp.n} не постои за {year}. <Link href="/nalozi">Листа на налози</Link></div></>;
    const ids = g.journals.map((j) => j.id);
    const L = await db().select({ l: journalLines, j: { id: journals.id, date: journals.date, description: journals.description }, p: { code: partners.code, name: partners.name } })
      .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId)).leftJoin(partners, eq(partners.id, journalLines.partnerId))
      .where(inArray(journalLines.journalId, ids)).orderBy(asc(journals.date), asc(journals.createdAt), asc(journalLines.lineNo));
    const t = lineTotals(L.map(({ l }) => l));
    const ds = g.journals.map((j) => j.date).sort();
    const title = g.journals.length === 1 ? g.journals[0]!.description ?? '' : (g.journals[0]!.description ?? '') + ` и уште ${g.journals.length - 1}`;
    return (
      <>
        <Hd t={'Налог за книжење бр. ' + g.no} sub={`${title} · ${dmy(ds[0])}${ds.at(-1) !== ds[0] ? ' – ' + dmy(ds.at(-1)) : ''}`}>
          <Link className="btn" href="/nalozi">← Листа на налози</Link>
          {gi > 0 ? <Link className="btn" href={`/nalozi?n=${encodeURIComponent(G[gi - 1]!.no)}`}>◀</Link> : <button className="btn" disabled>◀</button>}
          {gi < G.length - 1 ? <Link className="btn" href={`/nalozi?n=${encodeURIComponent(G[gi + 1]!.no)}`}>▶</Link> : <button className="btn" disabled>▶</button>}
          <DownloadCsv name={`Nalog_${g.no.replace(/\W+/g, '_')}_${year}.csv`} label="Excel"
            rows={[['Р.бр.', 'Датум', 'Конто', 'Должи', 'Побарува', 'Шифра', 'Комитент', 'Опис', 'Документ'],
              ...L.map(({ l, j, p }, i) => [i + 1, dmy(j.date), l.account, Number(l.debit), Number(l.credit), p?.code ?? '', p?.name ?? '', l.note || j.description || '', l.doc ?? ''])]} />
        </Hd>
        {g.journals.length > 1 && (
          <div className="card">
            <h2>Документи во налогот ({g.journals.length})</h2>
            <div className="tw"><table className="dense"><tbody>
              {g.journals.map((j) => (
                <tr key={j.id}><td>{dmy(j.date)}</td><td>{j.description}</td><td className="n">{fmt(j.D)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {canEdit(j) && <Link className="btn sm" href={`/nalozi?edit=${j.id}`}>✎ Корекција</Link>}{' '}
                    {del && editable(j) && <RowAction action={deleteJournalAction.bind(null, j.id)} label="🗑" title="Избриши" confirm={`Да се избрише „${j.description ?? j.number}“?`} style={{ color: 'var(--bad)' }} />}
                  </td></tr>
              ))}
            </tbody></table></div>
          </div>
        )}
        {g.journals.length === 1 && (
          <div className="row" style={{ marginBottom: 8, gap: 8 }}>
            {canEdit(g.journals[0]!) && <Link className="btn pri" href={`/nalozi?edit=${g.journals[0]!.id}`}>✎ Корекција (F2)</Link>}
            {del && editable(g.journals[0]!) && <RowAction className="btn danger" action={deleteJournalAction.bind(null, g.journals[0]!.id)} label="🗑 Избриши налог" confirm={`Да се избрише налогот бр. ${g.no}? Ова не може да се врати.`} />}
            {g.journals[0]!.periodFrom && <span className="pill info">период {dmy(g.journals[0]!.periodFrom)} – {dmy(g.journals[0]!.periodTo)}</span>}
            {(g.journals[0]!.locked || (firm.lockDate && g.journals[0]!.date <= firm.lockDate)) && <span className="pill">🔒 заклучен</span>}
          </div>
        )}
        <div className="tw"><table className="dense nalg">
          <thead><tr><th className="n">Р.бр.</th><th>Датум</th><th>Конто</th><th className="n">Должи</th><th className="n">Побарува</th><th>Шифра</th><th>Комитент</th><th style={{ minWidth: 240 }}>Опис / содржина</th><th>Документ</th></tr></thead>
          <tbody>
            {L.map(({ l, j, p }, i) => (
              <tr key={l.id}>
                <td className="n">{i + 1}</td><td style={{ whiteSpace: 'nowrap' }}>{dmy(j.date)}</td>
                <td><Link href={`/kkart?k=${l.account}`}><b className="num">{l.account}</b></Link></td>
                <td className="n">{fmt(l.debit)}</td><td className="n">{fmt(l.credit)}</td>
                <td>{p?.code}</td><td>{p?.name}</td>
                <td>{j.description}{l.note && l.note !== j.description && <><br /><small className="mut">{l.note}</small></>}</td>
                <td>{l.doc}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td colSpan={3}>Вкупно ({L.length} ставки) {t.balanced ? <span className="pill good">изедначен</span> : <span className="pill bad">неизедначен · разлика {fmt(t.diff)}</span>}</td>
            <td className="n">{fmt(t.D)}</td><td className="n">{fmt(t.P)}</td><td colSpan={4} />
          </tr></tfoot>
        </table></div>
      </>
    );
  }

  /* ---------- line search (legacy: filter of the journal by konto / document / partner) ---------- */
  const q = (sp.q ?? '').trim();
  const hits = q ? await db().select({ l: journalLines, j: { date: journals.date, number: journals.number, description: journals.description }, p: partners.name })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId)).leftJoin(partners, eq(partners.id, journalLines.partnerId))
    .where(and(inYear, or(ilike(journalLines.account, `${q}%`), ilike(journals.description, `%${q}%`), ilike(journalLines.note, `%${q}%`),
      ilike(journalLines.doc, `%${q}%`), ilike(partners.name, `%${q}%`), eq(journals.number, q))))
    .orderBy(asc(journals.date), asc(journalLines.lineNo)).limit(500) : [];
  const S = firmNalogSettings(firm);
  const settingsOk = canDo(u, 'settings', firm.id), closeOk = canDo(u, 'close', firm.id);

  return (
    <>
      <Hd t="Налози за книжење" sub={`дневник · ${year}`}>
        <form className="row" style={{ gap: 6 }}><input name="q" defaultValue={q} placeholder="Барај конто, документ…" style={{ width: 200 }} /></form>
        <DownloadCsv name={`Dnevnik_${year}.csv`} label="CSV" rows={[['Налог', 'Датум', 'Опис', 'Ставки', 'Должи', 'Побарува'],
          ...G.map((g) => [g.no, dmy(g.date), g.journals.map((j) => j.description).filter(Boolean).slice(0, 3).join('; '), g.journals.reduce((s, j) => s + j.n, 0),
            Number(g.journals.reduce((s, j) => s + Number(j.D), 0).toFixed(2)), Number(g.journals.reduce((s, j) => s + Number(j.P), 0).toFixed(2))])]} />
        {write && <Link className="btn pri" href="/nalozi?nov">+ Рачен налог</Link>}
      </Hd>
      {q && (
        <>
          <div className="row"><span className="pill info">Филтер: {q}</span><Link className="btn sm" href="/nalozi">Прикажи сè</Link></div>
          {hits.length ? (
            <div className="tw"><table>
              <thead><tr><th>Налог</th><th>Датум</th><th>Документ</th><th>Конто</th><th className="n">Должи</th><th className="n">Побарува</th></tr></thead>
              <tbody>{hits.map(({ l, j, p }) => (
                <tr key={l.id}>
                  <td><Link className="btn sm" href={`/nalozi?n=${encodeURIComponent(j.number)}`}>бр. {j.number}</Link></td><td>{dmy(j.date)}</td>
                  <td>{j.description}{l.doc ? ' · ' + l.doc : ''}</td><td><span className="num">{l.account}</span>{p ? ' · ' + p : ''}</td>
                  <td className="n">{Number(l.debit) ? fmt(l.debit) : ''}</td><td className="n">{Number(l.credit) ? fmt(l.credit) : ''}</td>
                </tr>))}</tbody>
              <tfoot><tr><td colSpan={4}>Вкупно</td><td className="n">{fmt(hits.reduce((s, h) => s + Number(h.l.debit), 0))}</td><td className="n">{fmt(hits.reduce((s, h) => s + Number(h.l.credit), 0))}</td></tr></tfoot>
            </table></div>
          ) : <div className="card empty">Нема ставки за „{q}“ во {year}.</div>}
        </>
      )}
      <div className="card">
        <div className="hd">
          <h2>Преглед на финансови налози за книжење</h2>
          <div className="row">
            {settingsOk && <Link className="btn sm" href={sp.cfg !== undefined ? '/nalozi' : '/nalozi?cfg'}>Нумерирање и шифри…</Link>}
            {firm.lockDate && <span className="pill">🔒 заклучено до {dmy(firm.lockDate)}</span>}
          </div>
        </div>
        {settingsOk && sp.cfg !== undefined && (
          <form action={saveNalogSettings} className="row" style={{ gap: '8px 16px', marginBottom: 10, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="mini">Нумерирање <select name="nalogMode" defaultValue={S.nalogMode} style={{ width: 'auto' }}>
              <option value="period">по вид и период (2/1-3, 6/1-3, 12/1-1…)</option><option value="doc">секој документ посебен налог (1, 2, 3…)</option></select></label>
            <label className="mini">Период <select name="nalogPer" defaultValue={S.nalogPer} style={{ width: 'auto' }}>
              <option value="quarter">тромесечно</option><option value="month">месечно</option></select></label>
            <label className="mini">Плати <select name="nalPayPer" defaultValue={S.nalPayPer} style={{ width: 'auto' }}>
              <option value="month">секој месец (12/1-1)</option><option value="year">цела година (12/1-12)</option></select></label>
            {(Object.keys(NAL_DEF) as NalDefKey[]).map((k) => (
              <label className="mini" key={k}>{NAL_DEF[k][1].toLowerCase()} <input name={'nc_' + k} defaultValue={nalCode(k, S)} style={{ width: 70 }} /></label>
            ))}
            <button className="btn sm pri">Зачувај</button>
            <span className="note">Промената важи за новите налози; веќе книжените го задржуваат својот број.</span>
          </form>
        )}
        {closeOk && (
          <form action={setLockDate} className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'end' }}>
            <label className="mini">Заклучи го периодот до <input type="date" name="lockDate" defaultValue={firm.lockDate ?? ''} style={{ width: 'auto' }} /></label>
            <button className="btn sm">🔒 Зачувај заклучување</button>
            <span className="note">До овој датум налозите не може да се книжат, менуваат или бришат (празно = отклучено).</span>
          </form>
        )}
        <div className="tw" style={{ maxHeight: 520 }}><table>
          <thead><tr><th>Датум</th><th>Број</th><th>Опис</th><th className="n">Ставки</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th><th></th></tr></thead>
          <tbody>
            {G.map((g) => {
              const D = g.journals.reduce((s, j) => s + Number(j.D), 0), P = g.journals.reduce((s, j) => s + Number(j.P), 0);
              const n = g.journals.reduce((s, j) => s + j.n, 0);
              const lbl = g.journals.length === 1 ? g.journals[0]!.description : `${g.journals[0]!.description ?? ''} (+${g.journals.length - 1})`;
              return (
                <tr key={g.no}>
                  <td>{dmy(g.date)}</td><td><b className="num">{g.no}</b></td><td>{lbl}</td><td className="n">{n}</td>
                  <td className="n">{fmt(D)}</td><td className="n">{fmt(P)}</td>
                  <td className="n" style={Math.abs(D - P) > 0.009 ? { color: 'var(--bad)' } : undefined}>{fmt(D - P)}</td>
                  <td><Link className="btn sm" href={`/nalozi?n=${encodeURIComponent(g.no)}`}>Отвори</Link></td>
                </tr>
              );
            })}
            {!G.length && <tr><td colSpan={8} className="empty">Нема налози за {year}.</td></tr>}
          </tbody>
        </table></div>
      </div>
      <p className="note">„Отвори“ го прикажува целиот налог со сите ставки – датум, конто, должи, побарува, комитент, опис и документ. Броевите се доделуваат при книжење и не се менуваат кога подоцна ќе се внесе документ со постар датум.</p>
    </>
  );
}
