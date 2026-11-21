/**
 * „🔁 Рекнижење во маса“ (Финансово, after Налози): filter the journal lines of the firm (period, konto or range,
 * partner, nalog kind / number, text, amount, cost centre), tick all or some, choose the new konto and / or partner,
 * see the preview (old → new per line, totals per konto before / after) and confirm — one batch, one audit row, one
 * „↶ Врати“. Locked period / nalog, closing nalog, closed VAT period, document partners and statement lines closed
 * against an invoice are refused with their reason (`@wise/core/reclass`, `@wise/db` `reclass.ts`). Owner / senior only.
 */
import Link from 'next/link';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { rcFilter, rcLabel, rcSum, type RcFilter } from '@wise/core/reclass';
import { codes, effectiveChart, journalLines, journals, reclassBatches, reclassLines, RECLASS_MAX_LINES, users } from '@wise/db';
import { booksPage, canDo, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { Hd, dmyHm } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { undoAction } from './actions';
import { RcClient } from './client';

type SP = { from?: string; to?: string; kf?: string; kt?: string; p?: string; kind?: string; num?: string; q?: string; amin?: string; amax?: string; loc?: string; go?: string };
const iso = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
const amt = (s?: string) => (s && s.trim() !== '' && Number.isFinite(Number(s.replace(/[\s.]/g, '').replace(',', '.'))) ? Number(s.replace(/[\s.]/g, '').replace(',', '.')) : null);
const SHOW = 3000;

export default async function ReknizPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('rekniz');
  if (!firm) return <NoFirm t="🔁 Рекнижење во маса" />;
  if (!canDo(u, 'reclass', firm.id)) {
    return <><Hd t="🔁 Рекнижење во маса" exp={false} /><div className="card empty">Рекнижењето во маса е само за администраторот (сопственикот) и главниот сметководител.</div></>;
  }
  const f: RcFilter = {
    from: iso(sp.from) ?? `${year}-01-01`, to: iso(sp.to) ?? `${year}-12-31`, kontoFrom: sp.kf?.trim() || undefined, kontoTo: sp.kt?.trim() || undefined,
    partnerId: sp.p || undefined, kind: sp.kind || undefined, number: sp.num?.trim() || undefined, text: sp.q?.trim() || undefined,
    amtMin: amt(sp.amin), amtMax: amt(sp.amax), locationId: sp.loc || undefined,
  };
  const searched = !!sp.go;
  const locIds = (await db().selectDistinct({ id: journalLines.locationId }).from(journalLines).where(and(eq(journalLines.firmId, firm.id), isNotNull(journalLines.locationId))))
    .map((r) => r.id!).filter(Boolean);
  const [P, chart, kinds, locs, B] = await Promise.all([
    partnerOptions(firm.id),
    effectiveChart(db(), firm.id),
    db().selectDistinct({ kind: journals.kind }).from(journals).where(eq(journals.firmId, firm.id)).orderBy(asc(journals.kind)),
    locIds.length ? db().select({ id: codes.id, name: codes.name }).from(codes).where(inArray(codes.id, locIds)) : Promise.resolve([]),
    reclassBatches(db(), firm.id),
  ]);
  const raw = searched ? await reclassLines(db(), firm.id, f) : [];
  const L = rcFilter(raw, f);
  const S = rcSum(L);
  const pName = new Map(P.map((p) => [p.id, p.name]));
  const kName = new Map(chart.map((c) => [c.code, c.name]));
  const uIds = [...new Set(B.flatMap((b) => [b.userId, b.undone?.userId]).filter(Boolean) as string[])];
  const U = uIds.length ? await db().select({ id: users.id, name: users.name, username: users.username }).from(users).where(inArray(users.id, uIds)) : [];
  const uName = (id: string | null) => (id ? U.find((x) => x.id === id)?.name || U.find((x) => x.id === id)?.username || '' : 'систем');

  return (
    <>
      <Hd t="🔁 Рекнижење во маса" sub={`${firm.name} · ${year}`} exp={false}>
        <Link className="btn ghost" href="/nalozi">Налози за книжење</Link>
      </Hd>
      <p className="note">За годишни корекции: пронајдете ги ставките, изберете ги, сменете конто и / или комитент – со преглед пред потврда. Износите не се менуваат, секој налог останува изедначен.
        Ставките од документи се коригираат преку корекцијата на налогот (остануваат и по повторно книжење на документот), ставките од изводи преку самиот извод. Заклучениот период не се менува.
        {firm.lockDate && <> Заклучено до <b>{dmy(firm.lockDate)}</b>.</>}</p>

      <form className="card" method="get" action="/rekniz">
        <input type="hidden" name="go" value="1" />
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="f">Од<input type="date" name="from" defaultValue={f.from} /></label>
          <label className="f">До<input type="date" name="to" defaultValue={f.to} /></label>
          <label className="f">Конто (или од)<input name="kf" defaultValue={sp.kf ?? ''} list="rc-konta" placeholder="на пр. 4030 или 40" style={{ width: 130 }} /></label>
          <label className="f">до конто<input name="kt" defaultValue={sp.kt ?? ''} list="rc-konta" placeholder="опсег" style={{ width: 110 }} /></label>
          <label className="f">Комитент<select name="p" defaultValue={sp.p ?? ''} style={{ maxWidth: 240 }}>
            <option value="">— сите —</option><option value="-">без комитент</option>
            {P.map((p) => <option key={p.id} value={p.id}>{p.code ? p.code + ' · ' : ''}{p.name}</option>)}</select></label>
          <label className="f">Вид налог<select name="kind" defaultValue={sp.kind ?? ''}><option value="">— сите —</option>{kinds.map((k) => <option key={k.kind} value={k.kind}>{k.kind}</option>)}</select></label>
          <label className="f">Број налог<input name="num" defaultValue={sp.num ?? ''} style={{ width: 90 }} /></label>
          <label className="f">Текст во описот<input name="q" defaultValue={sp.q ?? ''} placeholder="опис, белешка, документ" style={{ width: 180 }} /></label>
          <label className="f">Износ од<input name="amin" inputMode="decimal" defaultValue={sp.amin ?? ''} style={{ width: 100, textAlign: 'right' }} /></label>
          <label className="f">до<input name="amax" inputMode="decimal" defaultValue={sp.amax ?? ''} style={{ width: 100, textAlign: 'right' }} /></label>
          {locs.length > 0 && <label className="f">Место на трошок<select name="loc" defaultValue={sp.loc ?? ''}><option value="">— сите —</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
          <button className="btn pri">🔍 Пребарај</button>
          {searched && <Link className="btn ghost" href="/rekniz">Исчисти</Link>}
        </div>
        <datalist id="rc-konta">{chart.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</datalist>
      </form>

      {searched && (
        <RcClient
          key={JSON.stringify(sp)}
          lines={L.slice(0, SHOW).map((l) => ({ ...l, partner: l.partnerId ? pName.get(l.partnerId) ?? '' : '', locked: !!(firm.lockDate && l.date <= firm.lockDate) || l.jlocked }))}
          total={S} more={L.length > SHOW || raw.length > RECLASS_MAX_LINES}
          partners={P.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
          chart={chart.map((c) => ({ code: c.code, name: c.name }))}
        />
      )}

      <div className="card">
        <div className="hd"><h2>Претходни рекнижења</h2><span className="note">секое рекнижење се враќа целосно со „↶ Врати“ (ставките изменети потоа или во заклучен период се прескокнуваат)</span></div>
        <div className="tw"><table>
          <thead><tr><th>Кога</th><th>Корисник</th><th>Промена</th><th className="n">Ставки</th><th className="n">Налози</th><th className="n">Износ</th><th>Состојба</th><th /></tr></thead>
          <tbody>
            {B.map((b) => {
              const sum = b.items.reduce((s, i) => s + i.debit + i.credit, 0);
              const from = [...new Set(b.items.map((i) => i.old.account))].slice(0, 4).join(', ');
              return (
                <tr key={b.id}>
                  <td>{dmyHm(b.at)}</td><td>{uName(b.userId)}</td>
                  <td>{from && b.change.account ? `${from} → ` : ''}{rcLabel(b.change, (k) => `${k} ${kName.get(k) ?? ''}`.trim(), (id) => (id ? pName.get(id) ?? '?' : ''))}</td>
                  <td className="n">{b.items.length}{b.blocked ? <span className="mini"> (+{b.blocked} прескокнати)</span> : null}</td>
                  <td className="n">{b.journals}</td><td className="n">{fmt(sum)}</td>
                  <td>{b.undone ? <span className="pill">вратено {dmyHm(b.undone.at)}{b.undone.skipped ? ` · ${b.undone.skipped} прескокнати` : ''}</span> : <span className="pill good">применето</span>}</td>
                  <td>{!b.undone && <RowAction action={undoAction.bind(null, b.id)} label="↶ Врати" className="btn sm" showOk inline
                    confirm={`Да се врати целото рекнижење (${b.items.length} ставки во ${b.journals} налози) на старите конта / комитенти?`} />}</td>
                </tr>
              );
            })}
            {!B.length && <tr><td colSpan={8} className="empty">Сè уште нема рекнижења за оваа фирма.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
