/**
 * Legacy `VIEWS.kompenzacii` 8926 — Финансово › Компензации: list, editor (partners → their open receivables and
 * payables, amounts auto-filled up to the smaller side — `kompAuto`), posting via `kompEntries`, print (изјава).
 */
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { kompAutoFill } from '@wise/core';
import { compensations, kompOpenItems } from '@wise/db';
import { booksPage, canDo, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteKompAction, saveKompAction } from './actions';

type SP = { nov?: string; edit?: string; p?: string | string[]; kind?: string; saved?: string };

export default async function KompenzaciiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('kompenzacii');
  if (!firm) return <NoFirm t="Компензации" />;
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const [list, P] = await Promise.all([
    db().select().from(compensations).where(eq(compensations.firmId, firm.id)).orderBy(desc(compensations.date)).limit(300),
    partnerOptions(firm.id),
  ]);
  const pName = new Map(P.map((p) => [p.id, p.name]));
  const edit = sp.edit ? list.find((k) => k.id === sp.edit) : undefined;
  const open = write && (sp.nov !== undefined || !!edit);
  const pids = edit ? [...new Set(edit.rows.map((r) => r.partnerId))] : (Array.isArray(sp.p) ? sp.p : sp.p ? [sp.p] : []).filter((x) => pName.has(x));
  const kind = edit?.kind ?? (sp.kind === 'multi' ? 'multi' : 'bi');
  const rows = open && pids.length ? await db().transaction((tx) => kompOpenItems(tx, firm.id, year, pids, edit?.id)) : [];
  const auto = kompAutoFill(rows);
  const amt = (refId: string, i: number) => {
    if (edit) { const r = edit.rows.find((x) => x.refId === refId); return r ? String(r.amt) : ''; }
    return auto[i] ? String(auto[i]! / 100) : '';
  };
  const today = new Date().toISOString().slice(0, 10);
  const saved = sp.saved ? list.find((k) => k.id === sp.saved) : undefined;

  return (
    <>
      <Hd t="Компензации" sub="билатерални и мултилатерални">
        {write && <Link className="btn pri" href="/kompenzacii?nov">+ Нова компензација</Link>}
      </Hd>
      {saved && <div className="callout good">Компензацијата {saved.number} е зачувана и книжена. <Link href={`/kompenzacii/print?id=${saved.id}`} target="_blank">🖨 Изјава</Link></div>}
      {open && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="hd"><h2>{edit ? 'Компензација ' + edit.number : 'Нова компензација'}</h2><Link className="btn" href="/kompenzacii">Откажи</Link></div>
          {!edit && (
            <form className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
              <input type="hidden" name="nov" value="" />
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
                      <td className="n"><input name={`amt:${r.refId}`} defaultValue={amt(r.refId, i)} inputMode="decimal" style={{ width: 120, textAlign: 'right' }} aria-label="Износ" /></td></tr>
                  ))}</tbody>
                </table></div>
              ) : <p className="note">Комитентот нема отворени ставки (книжења на 120–128 / 220–228 по број на документ).</p>}
              <div className="row"><span className="note">Побарувањата и обврските мора да бидат еднакви. Износите се пополнети автоматски до помалиот износ.</span><span style={{ flex: 1 }} /><button className="btn pri">Зачувај и книжи</button></div>
            </BankForm>
          )}
        </div>
      )}
      {list.length ? (
        <div className="tw"><table>
          <thead><tr><th>Број</th><th>Датум</th><th>Вид</th><th>Комитенти</th><th className="n">Износ</th><th></th></tr></thead>
          <tbody>{list.map((k) => (
            <tr key={k.id}><td>{k.number}</td><td>{dmy(k.date)}</td><td>{k.kind === 'multi' ? 'Мултилатерална' : 'Билатерална'}</td>
              <td>{[...new Set(k.rows.map((r) => pName.get(r.partnerId) ?? ''))].join(', ')}</td><td className="n">{fmt(Number(k.total))}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <Link className="btn sm" href={`/kompenzacii/print?id=${k.id}`} target="_blank">🖨 Изјава</Link>{' '}
                {write && <Link className="btn sm" href={`/kompenzacii?edit=${k.id}`}>Измени</Link>}{' '}
                {del && <RowAction action={deleteKompAction.bind(null, k.id)} label="🗑" className="btn sm ghost danger" confirm={`Да се избрише компензацијата ${k.number} и налогот?`} />}
              </td></tr>
          ))}</tbody>
        </table></div>
      ) : <div className="card empty">Нема компензации.</div>}
    </>
  );
}

