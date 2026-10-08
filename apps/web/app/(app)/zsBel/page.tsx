/**
 * Legacy `VIEWS.zsBel` 10929 (`BEL`, `belAuto`, `belHTML`, ACT `belSave`/`belReset`/`belPdf`) — phase 5 explanatory
 * notes, filled from the statements of this and the previous year; the text is editable and saved per year.
 */
import Link from 'next/link';
import { belResolve } from '@wise/core';
import { phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ActionForm } from '@/components/yearend/action-form';
import { ZsHead } from '@/components/yearend/ph-bar';
import { resetNote, saveNotes } from '../zsProc/actions';
import { belFirm } from '@/components/yearend/print-forms';

const fa = (v: number) => (v ? Math.round(v).toLocaleString('de-DE') : '-');

export default async function ZsBelPage() {
  const c = await yePage('zsBel');
  if (!c) return <NoFirm t="Објаснувачки белешки" />;
  const { L, firm, year } = c;
  const notes = belResolve(belFirm(firm), year, L.Y.co.zs.V, L.prev.V, L.statement?.notes, L.prevStatement?.notes);
  return (
    <>
      <ZsHead id="zsBel" t="Објаснувачки белешки" year={year} ent={L.ent} done={phaseDone(L)}>
        <Link className="btn pri" href="/pecati/bel" target="_blank">🖨 Печати / PDF</Link>
      </ZsHead>
      <div className="callout">Белешките се пополнуваат автоматски од Билансот на состојба и Билансот на успех – <b>{year}</b> и <b>{year - 1}</b>. Текстот може да го менувате; се зачувува за оваа фирма и година. Се прикачуваат во ЦРМ заедно со годишната сметка.</div>
      <ActionForm action={saveNotes} submit="Зачувај">
        {notes.map((n) => (
          <div className="bel" key={n.id} style={{ margin: '0 0 10px' }}>
            <div style={{ fontWeight: 700, margin: '0 0 3px' }}>{n.no}. {n.title}</div>
            {n.rows.length > 0 && (
              <table className="dense" style={{ maxWidth: 640 }}>
                <thead><tr><th>Позиција</th><th style={{ width: 44 }}>АОП</th><th className="n" style={{ width: 110 }}>{year}</th><th className="n" style={{ width: 110 }}>{year - 1}</th></tr></thead>
                <tbody>{n.rows.map((r) => <tr key={r.aop}><td>{r.label}</td><td>{r.aop}</td><td className="n">{fa(r.cur)}</td><td className="n">{fa(r.prev)}</td></tr>)}</tbody>
              </table>
            )}
            <input type="hidden" name={'auto:' + n.id} value={n.auto} />
            <textarea name={'bel:' + n.id} rows={n.text.length > 220 ? 5 : 2} style={{ width: '100%', marginTop: 4 }} defaultValue={n.text} placeholder="Дополнителен текст (по желба)" />
            {n.saved && n.auto && <RowAction action={resetNote.bind(null, n.id)} label="↺ автоматски текст" />}
          </div>
        ))}
      </ActionForm>
    </>
  );
}
