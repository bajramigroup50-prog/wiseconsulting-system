/**
 * „⏸ За проверка – минат период“ (scan screen, „масовно“, the inbox): the read documents a bulk save HELD because their
 * date is in a past VAT period (closed / filed, or earlier than today's period when the firm holds those). Each row:
 * the document, its date, the period and whether that period's ДДВ-04 is closed / filed. The owner (or a user with the
 * `fix` / `settings` right) decides per row; the others see the rows without the buttons.
 */
import Link from 'next/link';
import { canDecidePast, OUTGOING_DATE_NOTE, pastDecisionOptions, pastHoldPrevious, vatPeriodName } from '@wise/core/vat/past-period';
import { periodOf } from '@wise/core';
import { heldScanDrafts, type Firm, type HeldDraft } from '@wise/db';
import type { SessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy, fmt, todayIso } from '@/lib/fmt';
import { isOfficeOwner } from '@/lib/office-owner';
import { RowAction } from '@/components/row-action';
import { confirmPastAction, rejectPastAction, setPastHoldAction } from '@/app/(app)/skan/actions';

export interface PastReviewData { H: HeldDraft[]; decide: boolean; hold: boolean; today: string; cur: string }

/** The data of the review (loaded by the page; the view itself is synchronous — no nested async component). */
export async function pastReviewData(u: SessionUser, firm: Firm, kind?: 'purchase' | 'sale'): Promise<PastReviewData> {
  const all = await heldScanDrafts(db(), firm.id);
  const today = todayIso();
  return {
    H: kind ? all.filter((h) => h.kind === kind) : all,
    decide: canDecidePast(u.principal, firm.id, await isOfficeOwner(u)),
    hold: pastHoldPrevious(firm.settings as Record<string, unknown>),
    today, cur: vatPeriodName(periodOf(today, firm.vatPeriod === 'month' ? 'month' : 'quarter')),
  };
}

export function PastReview({ data: { H, decide, hold, today, cur }, hideEmpty }: { data: PastReviewData; hideEmpty?: boolean }) {
  if (!H.length && (!decide || hideEmpty)) return null;
  return (
    <div className="card" id="past-review">
      <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>⏸ За проверка – минат период {H.length > 0 && <span className="pill warn" data-past-count={H.length}>{H.length}</span>}</h2>
      <p className="note" style={{ margin: '0 0 8px' }}>
        Документите со датум во минат ДДВ период не се книжат автоматски („Зачувај ги сите спремни“, увоз, пристигнати документи) – книжењето го менува ДДВ-04 на период што е веќе подготвен или поднесен.
        Се задржуваат документите од <b>затворени (поднесени)</b> периоди{hold ? <> и од <b>сите претходни</b> периоди (пред {cur})</> : ''}.
        {decide && <> <RowAction label={hold ? 'Задржувај само затворени периоди' : 'Задржувај ги сите претходни периоди'} action={setPastHoldAction.bind(null, !hold)}
          confirm={hold ? 'Да се задржуваат само документите од затворени (поднесени) ДДВ периоди? Документите од претходни, незатворени периоди ќе се книжат автоматски.' : 'Да се задржуваат сите документи од претходни ДДВ периоди („Задржи ги сите документи од претходни ДДВ периоди“)?'} /></>}
      </p>
      {H.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Документ</th><th>Број</th><th>Датум</th><th>{H.some((h) => h.kind === 'sale') ? 'Купувач / добавувач' : 'Добавувач'}</th><th className="n">Вкупно</th><th>ДДВ период</th><th>ДДВ-04</th><th></th></tr></thead>
          <tbody>{H.map((h) => {
            const o = pastDecisionOptions(h.kind, h.past);
            return (
              <tr key={h.docId + ':' + h.index} data-past={h.past.reason}>
                <td>{h.kind === 'sale' ? 'Излезна' : 'Влезна'}{h.fileId && <> · <a href={`/api/files/${h.fileId}`} target="_blank" rel="noreferrer">датотека</a></>}</td>
                <td>{h.number}</td><td>{dmy(h.date)}</td><td>{h.party}</td><td className="n">{fmt(h.total)}</td>
                <td><span className="pill warn">⏸ минат период – за проверка</span><div className="mini">{h.past.text}</div></td>
                <td>{h.past.closed ? <span className="pill bad">затворена / поднесена</span> : h.past.reason === 'locked' ? <span className="pill bad">заклучено</span> : <span className="pill">не е затворена во WISE</span>}</td>
                <td className="row" style={{ gap: 4 }}>
                  {decide ? <>
                    {o.own
                      ? <RowAction className="btn sm" label="✓ Прокнижи во својот период" action={confirmPastAction.bind(null, h.docId, h.index, 'own', null)}
                        confirm={`Да се прокнижи ${h.number} од ${dmy(h.date)} во ${h.past.text}? ДДВ-04 за тој период треба да се коригира.`} />
                      : <span className="mini" title={o.ownWhyNot}>Во својот период: {o.ownWhyNot}</span>}
                    {o.receipt && <RowAction className="btn sm" label="Прокнижи со датум на прием во тековниот период" action={confirmPastAction.bind(null, h.docId, h.index, 'receipt', today)}
                      confirm={`Да се прокнижи влезната фактура ${h.number} со датум на прием ${dmy(today)} (${cur})? Датумот на фактурата останува ${dmy(h.docDate ?? h.date)}; претходниот ДДВ се користи во тековниот период.`} />}
                    <RowAction label="✕ Отфрли" action={rejectPastAction.bind(null, h.docId, h.index)} confirm={`Да се отфрли (избрише) нацртот ${h.number}?`} />
                  </> : <span className="mini">Одлучува сопственикот</span>}
                </td>
              </tr>);
          })}</tbody>
        </table></div>
      ) : <div className="mini">Нема задржани документи.</div>}
      {H.some((h) => h.kind === 'sale') && <p className="mini" style={{ margin: '6px 0 0' }}>{OUTGOING_DATE_NOTE}</p>}
      <p className="mini" style={{ margin: '4px 0 0' }}>Документите прокнижени во минат период: <Link href="/ddv?late=1#late">ДДВ-04 → Корекции на ДДВ-04 потребни</Link>.</p>
    </div>
  );
}
