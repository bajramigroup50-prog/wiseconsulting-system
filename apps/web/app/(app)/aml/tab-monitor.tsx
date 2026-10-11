/** 📡 Мониторинг — alerts from the books (cash ≥ 15.000 €, linked / split cash, high-risk countries) and their review. */
import { AML_CASH_EUR, AML_RULE_LBL, amlDueState, amlKindOf, type AmlRule } from '@wise/core/office';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { dmy } from '@/components/hd';
import { fmt } from '@/lib/fmt';
import { amlScanRun } from './ufr-actions';
import { DecideForm } from './decide-form';
import type { AmlFirm, AmlRep } from './report-form';

export function TabMonitor({ clients, reports, today }: { clients: AmlFirm[]; reports: AmlRep[]; today: string }) {
  const A = reports.filter((r) => amlKindOf(r.data) === 'alert');
  const open = A.filter((r) => r.status === 'нова' || r.status === 'анализа');
  const closed = A.filter((r) => !open.includes(r));
  const D = (r: AmlRep) => r.data as { rule?: AmlRule; date?: string; amount?: number; due?: string; decision?: { at: string; byName: string; result: string; reason: string } };
  return (
    <>
      <ActionForm action={amlScanRun} reset={false}>
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Мониторинг на книгите</h2>
        <div className="form">
          <label className="f">Клиент<select name="firmId" defaultValue=""><option value="">сите клиенти</option>{clients.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label className="f">Од<input type="date" name="from" defaultValue={`${today.slice(0, 4)}-01-01`} /></label>
          <label className="f">До<input type="date" name="to" defaultValue={today} /></label>
        </div>
        <button className="btn pri" style={{ marginTop: 6 }}>📡 Провери ги книжењата</button>
        <p className="mini" style={{ margin: '6px 0 0' }}>Се проверуваат сметките 100–108: готовина (102, 105) од {fmt(AML_CASH_EUR)} € и повеќе (во денарска противвредност по курсот од поставките), поврзани готовински трансакции на ист клиент/корисник во еден работен ден (чл. 2 т.14), готовина поделена под прагот (прозорец од поставките) и плаќања/наплати со лица од високоризични земји. Префрлањата меѓу паричните сметки (полог на готовина во банка) не се сметаат. Сигналите се додаваат само еднаш.</p>
      </ActionForm>
      <div className="card tw">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>За преглед ({open.length})</h2>
        {open.length ? <table className="dense">
          <thead><tr><th>Рок</th><th>Клиент</th><th>Правило</th><th>Датум</th><th className="n">Износ</th><th>Опис</th><th>Одлука</th></tr></thead>
          <tbody>{open.map((r) => {
            const d = D(r), s = amlDueState(d.due, today, false);
            return (
              <tr key={r.id}>
                <td><Pill c={s === 'late' ? 'bad' : s === 'today' || s === 'soon' ? 'warn' : 'info'}>{dmy(d.due)}</Pill></td>
                <td>{r.firmName}</td><td className="mini">{d.rule ? AML_RULE_LBL[d.rule] : ''}</td><td>{dmy(d.date)}</td>
                <td className="n">{fmt(Number(d.amount) || 0)}</td><td className="mini">{r.text}</td>
                <td className="noprint"><DecideForm id={r.id} cash={d.rule === 'cash' || d.rule === 'cashLinked'} /></td>
              </tr>
            );
          })}</tbody>
        </table> : <div className="empty">Нема отворени сигнали.</div>}
      </div>
      {closed.length > 0 && <div className="card tw">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Прегледани ({closed.length})</h2>
        <table className="dense">
          <thead><tr><th>Клиент</th><th>Правило</th><th>Датум</th><th className="n">Износ</th><th>Одлука</th><th>Образложение</th><th>Одлучил</th></tr></thead>
          <tbody>{closed.map((r) => {
            const d = D(r);
            return <tr key={r.id}><td>{r.firmName}</td><td className="mini">{d.rule ? AML_RULE_LBL[d.rule] : ''}</td><td>{dmy(d.date)}</td><td className="n">{fmt(Number(d.amount) || 0)}</td>
              <td>{d.decision?.result === 'none' ? 'без сомневање' : 'извештај до УФР'}</td><td className="mini">{d.decision?.reason}</td><td className="mini">{d.decision ? `${dmy(d.decision.at)} ${d.decision.byName}` : ''}</td></tr>;
          })}</tbody>
        </table>
      </div>}
    </>
  );
}
