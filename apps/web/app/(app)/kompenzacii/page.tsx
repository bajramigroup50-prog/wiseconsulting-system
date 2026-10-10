/**
 * Legacy `VIEWS.kompenzacii` 8926 — Финансово › Компензации: list, editor (partners → their open receivables and
 * payables, amounts auto-filled up to the smaller side — `kompAuto`), posting via `kompEntries`, print (изјава).
 */
import Link from 'next/link';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { kompAutoFill } from '@wise/core';
import { compensations, journals, KOMP_SOURCE_TYPE, kompOpenItems } from '@wise/db';
import { KompTotals } from './komp-totals';
import { booksPage, canDo, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteKompAction, saveKompAction } from './actions';

type SP = { nov?: string; edit?: string; p?: string | string[]; kind?: string; saved?: string; auto?: string };

export default async function KompenzaciiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('kompenzacii');
  if (!firm) return <NoFirm t="Компензации" />;
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const [list, P] = await Promise.all([
    // legacy 8926: the compensations of the business year
    db().select().from(compensations).where(and(eq(compensations.firmId, firm.id), sql`${compensations.date} between ${year + '-01-01'} and ${year + '-12-31'}`)).orderBy(desc(compensations.date)),
    partnerOptions(firm.id),
  ]);
  const pName = new Map(P.map((p) => [p.id, p.name]));
  const edit = sp.edit ? list.find((k) => k.id === sp.edit) : undefined;
  const open = write && (sp.nov !== undefined || !!edit);
  // edit: the kind and the partners can be changed too (legacy editor 8956)
  const qp = (Array.isArray(sp.p) ? sp.p : sp.p ? [sp.p] : []).filter((x) => pName.has(x));
  const pids = edit && !qp.length ? [...new Set(edit.rows.map((r) => r.partnerId))] : qp;
  const kind = sp.kind === 'multi' || sp.kind === 'bi' ? sp.kind : edit?.kind ?? 'bi';
  const rows = open && pids.length ? await db().transaction((tx) => kompOpenItems(tx, firm.id, year, pids, edit?.id)) : [];
  const auto = kompAutoFill(rows);
  // legacy 8960–8962: amounts are auto-filled (smaller side) only for a bilateral compensation, or on „⚖ Пополни автоматски“
  const doAuto = sp.auto === '1' || (!edit && kind === 'bi');
  const amt = (refId: string, i: number) => {
    if (edit && sp.auto !== '1') { const r = edit.rows.find((x) => x.refId === refId); if (r) return String(r.amt); }
    return doAuto && auto[i] ? String(auto[i]! / 100) : '';
  };
  const J = list.length ? await db().select({ id: journals.sourceId, number: journals.number }).from(journals)
    .where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, KOMP_SOURCE_TYPE), inArray(journals.sourceId, list.map((k) => k.id)))) : [];
  const nalog = new Map(J.map((j) => [j.id, j.number]));
  const autoHref = '/kompenzacii?' + new URLSearchParams([...(edit ? [['edit', edit.id]] : [['nov', '']]), ['kind', kind], ...pids.map((p) => ['p', p]), ['auto', '1']]).toString();
  const today = new Date().toISOString().slice(0, 10);
  const saved = sp.saved ? list.find((k) => k.id === sp.saved) : undefined;

  return (
    <>
      <Hd t="Компензации" sub={`билатерални и мултилатерални · ${year}`}>
        {write && <Link className="btn pri" href="/kompenzacii?nov">+ Нова компензација</Link>}
      </Hd>
      {saved && <div className="callout good">Компензацијата {saved.number} е зачувана и книжена. <Link href={`/kompenzacii/print?id=${saved.id}`} target="_blank">🖨 Изјава</Link></div>}
      {open && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="hd"><h2>{edit ? 'Компензација ' + edit.number : 'Нова компензација'}</h2><Link className="btn" href="/kompenzacii">Откажи</Link></div>
          {(
            <form className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
              {edit ? <input type="hidden" name="edit" value={edit.id} /> : <input type="hidden" name="nov" value="" />}
              <label className="f">Вид<select name="kind" defaultValue={kind}><option value="bi">Билатерална</option><option value="multi">Мултилатерална</option></select></label>
              <label className="f" style={{ minWidth: 260 }}>Комитенти{kind === 'multi' ? ' (Ctrl за повеќе)' : ''}
                <select name="p" multiple={kind === 'multi'} defaultValue={kind === 'multi' ? pids : pids[0] ?? ''} size={kind === 'multi' ? 6 : undefined}>
                  {kind !== 'multi' && <option value="">— изберете —</option>}
                  {P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
              <button className="btn">+ Отворени ставки на комитентот</button>
            </form>
          )}
          {pids.length > 0 && (
            <BankForm action={saveKompAction}>
              {edit && <input type="hidden" name="id" value={edit.id} />}
              <input type="hidden" name="kind" value={kind} />
              {pids.map((p) => <input key={p} type="hidden" name="p" value={p} />)}
              <div className="form">
                <label className="f">Датум<input type="date" name="date" defaultValue={edit?.date ?? (today.startsWith(String(year)) ? today : `${year}-12-31`)} required /></label>
                <label className="f">Број<input name="number" defaultValue={edit?.number ?? ''} placeholder="автоматски К-nnn/година" /></label>
                <label className="f wide">Забелешка<input name="note" defaultValue={edit?.note ?? ''} /></label>
              </div>
              {rows.length ? (
                <div className="tw"><table className="dense">
                  <thead><tr><th>Комитент</th><th>Вид</th><th>Документ</th><th>Датум</th><th>Конто</th><th className="n">Отворено</th><th className="n">За компензирање</th></tr></thead>
                  <tbody>{rows.map((r, i) => (
                    <tr key={r.refId}><td>{pName.get(r.partnerId)}</td><td>{r.side === 'rec' ? 'Наше побарување' : 'Наша обврска'}</td><td>{r.docNo || <i className="mut">без број</i>}</td>
                      <td>{dmy(r.date)}</td><td>{r.konto}</td><td className="n">{fmt(r.open / 100)}</td>
                      <td className="n"><input name={`amt:${r.refId}`} data-side={r.side} defaultValue={amt(r.refId, i)} inputMode="decimal" style={{ width: 120, textAlign: 'right' }} aria-label="Износ" /></td></tr>
                  ))}</tbody>
                  <KompTotals />
                </table></div>
              ) : <p className="note">Комитентот нема отворени ставки (книжења на 120–128 / 220–228 по број на документ).</p>}
              <div className="row"><span className="note">Побарувањата и обврските мора да бидат еднакви.</span>{kind === 'bi' && <Link className="btn" href={autoHref}>⚖ Пополни автоматски (помалиот износ)</Link>}<span style={{ flex: 1 }} /><button className="btn pri">Зачувај и книжи</button></div>
            </BankForm>
          )}
        </div>
      )}
      {list.length ? (
        <div className="tw"><table>
          <thead><tr><th>Датум</th><th>Број</th><th>Вид</th><th>Учесници</th><th className="n">Износ</th><th>Налог</th><th></th></tr></thead>
          <tbody>{list.map((k) => (
            <tr key={k.id}><td>{dmy(k.date)}</td><td>{k.number}</td><td>{k.kind === 'multi' ? 'Мултилатерална' : 'Билатерална'}</td>
              <td>{[...new Set(k.rows.map((r) => pName.get(r.partnerId) ?? ''))].join(', ')}</td><td className="n">{fmt(Number(k.total))}</td>
              <td>{nalog.get(k.id) ? <Link className="btn sm" href={`/nalozi?n=${encodeURIComponent(nalog.get(k.id)!)}`}>бр. {nalog.get(k.id)}</Link> : ''}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <Link className="btn sm" href={`/kompenzacii/print?id=${k.id}`} target="_blank">🖨 Изјава</Link>{' '}
                {write && <Link className="btn sm" href={`/kompenzacii?edit=${k.id}`}>Измени</Link>}{' '}
                {del && <RowAction action={deleteKompAction.bind(null, k.id)} label="🗑" className="btn sm ghost danger" confirm={`Да се избрише компензацијата ${k.number}? Фактурите повторно стануваат отворени.`} />}
              </td></tr>
          ))}</tbody>
        </table></div>
      ) : <div className="card empty">Нема компензации за {year}.</div>}
      <p className="note">Билатерална компензација: со еден комитент се пребиваат нашите побарувања (купувач – 1200) и нашите обврски (добавувач – 2200). Мултилатерална: повеќе учесници, збирот на побарувањата е еднаков на збирот на обврските. Книжење: Должи 2200 (обврски) / Побарува 1200 (побарувања) по документ – фактурите се затвораат.</p>
    </>
  );
}

