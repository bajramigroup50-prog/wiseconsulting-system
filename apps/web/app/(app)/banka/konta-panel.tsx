/**
 * „Конта за изводи“ on the bank accounts screen (owner / chief accountant — `settings`): the per-firm bank kontos
 * (customer, supplier, daily turnover, cash withdrawal, own transfer, FX transfer, POS) validated against the chart,
 * the bank konto layout of the statement journal (збирно / по ставка), the move of the existing own-transfer lines
 * 1009 → 10091 (list before the confirm) and the re-post of the year's statements in the current layout.
 */
import { BANK_KONTA_FIELDS } from '@wise/core';
import { bankAccountKontos, bankKontaPanel, moveTransitLines, unregisteredOwnAccounts, type ChartEntry } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { BankForm } from '@/components/bank-form';
import { RowAction } from '@/components/row-action';
import { moveTransitAction, repostLayoutAction, saveBankAccountAction, saveBankKontaAction, setBankAccountKontoAction, setBankAccountKontoFormAction } from './actions';

export async function KontaPanel({ firmId, year, chart, fx }: { firmId: string; year: number; chart: ChartEntry[]; fx: boolean }) {
  const [P, mv, own, AK] = await Promise.all([
    db().transaction((tx) => bankKontaPanel(tx, firmId)),
    db().transaction((tx) => moveTransitLines(tx, { firmId, userId: null, year, dry: true })),
    db().transaction((tx) => unregisteredOwnAccounts(tx, firmId)),
    db().transaction((tx) => bankAccountKontos(tx, firmId)),
  ]);
  const name = (k: string | undefined) => chart.find((a) => a.code === k)?.name ?? '';
  const todo = mv.items.filter((i) => !i.skipped);
  const byLbl = { acct: 'сопствена сметка', edb: 'ЕДБ на фирмата', name: 'назив на фирмата', tech: 'посебна сметка' } as const;
  return (
    <div className="card" id="bkKonta">
      <h2>Конта за изводи</h2>
      <datalist id="bkKA">{chart.filter((a) => a.code.length >= 4).map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
      {AK.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 4px' }}>Конто на секоја банкарска сметка</h3>
          <div className="tw"><table className="dense">
            <thead><tr><th>Сметка</th><th>Број</th><th>Конто</th><th>Предлог</th></tr></thead>
            <tbody>{AK.map((a) => (
              <tr key={a.id}>
                <td>{a.name}{a.cur !== 'MKD' ? ` (${a.cur})` : ''}</td><td>{a.account ?? ''}</td>
                <td>
                  <BankForm action={setBankAccountKontoFormAction} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}
                    confirm="Да се постави контото на сметката (рачно – програмата веќе нема да го менува) и да се прекнижат нејзините изводи во отворените периоди?">
                    <input type="hidden" name="id" value={a.id} />
                    <input name="konto" list="bkKA" defaultValue={a.konto} style={{ width: 110 }} aria-label="Конто" title={name(a.konto)} />
                    <button className="btn sm" title="Прекнижи ги изводите на оваа сметка (само отворени периоди)">Зачувај и прекнижи</button>
                    {a.manual ? <span className="pill" title="Поставено рачно – не се менува автоматски">рачно</span> : null}
                  </BankForm>
                  <small className="note">{name(a.konto)}</small>
                </td>
                <td>{a.suggest ? (
                  <span className="row" style={{ gap: 6 }}>Предлог: <b>{a.suggest.konto}</b> {a.suggest.name}
                    <RowAction className="btn sm pri" showOk action={setBankAccountKontoAction.bind(null, a.id, a.suggest.konto)} label="Примени и прекнижи"
                      confirm={`Сметката „${a.name}“ да се префрли од ${a.konto} на ${a.suggest.konto} ${a.suggest.name} и да се прекнижат нејзините изводи во отворените периоди? Изводите во заклучен период остануваат.`} /></span>
                ) : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      <BankForm action={saveBankKontaAction} className="form">
        {BANK_KONTA_FIELDS.map((f) => (
          <label key={f.key} className="f" title={P.overrides[f.key] ? 'Поставено за фирмата' : 'Стандардно'}>
            {f.label}{f.note ? ` (${f.note})` : ''}
            <input name={f.key} list="bkKA" defaultValue={P.overrides[f.key] ?? ''} placeholder={`${P.defaults[f.key] ?? ''} ${name(P.defaults[f.key])}`.trim()} style={{ width: 240 }} />
            <small className="note">сега: <b>{P.konta[f.key]}</b> {name(P.konta[f.key])}</small>
          </label>
        ))}
        <label className="f">Банкарско конто во налогот
          <select name="layout" defaultValue={P.layout}>
            <option value="sum">збирно (стандардно) – еднаш Д / П на крајот</option>
            <option value="line">по ставка – до секоја ставка</option>
          </select>
        </label>
        <div className="row" style={{ width: '100%' }}><button className="btn pri">Зачувај</button>
          <span className="note">Празно поле = стандардното конто (шема / контен план). Секое конто мора да постои во контниот план.</span></div>
      </BankForm>

      {own.length > 0 && !fx && (
        <div className="callout warn" style={{ marginTop: 8 }}>
          <b>Сметки на самата фирма што не се внесени</b> (комитентот е фирмата по назив / ЕДБ) – ставките се книжат како пренос на {P.konta.transit}. Внесете ги како сопствени сметки:
          {own.map((o) => (
            <BankForm key={o.account} action={saveBankAccountAction} className="row" style={{ gap: 6, marginTop: 4 }}>
              <input name="name" defaultValue={o.name ? `${o.name}`.slice(0, 60) : `Сметка ${o.account}`} style={{ width: 240 }} aria-label="Назив" />
              <input name="account" defaultValue={o.account} style={{ width: 170 }} aria-label="Сметка" />
              <input type="hidden" name="cur" value="MKD" />
              <input name="konto" list="bkKA" placeholder="конто, на пр. 100002" style={{ width: 140 }} required aria-label="Конто" />
              <span className="mini">{o.lines} ставки</span>
              <button className="btn sm">Внеси ја сметката</button>
            </BankForm>
          ))}
        </div>
      )}

      {mv.from !== mv.to && mv.items.length > 0 && (
        <details style={{ marginTop: 8 }} open>
          <summary><b>Пренос меѓу сопствени сметки на {mv.from}</b>: {todo.length} ставки во {mv.statements} изводи за {year}{mv.skipped.length ? ` · ${mv.skipped.length} изводи во заклучен период` : ''}</summary>
          <div className="tw" style={{ maxHeight: 260 }}><table className="dense">
            <thead><tr><th>Датум</th><th>Извод</th><th>Комитент / опис</th><th className="n">Износ</th><th>Препознаено по</th><th></th></tr></thead>
            <tbody>{mv.items.map((i) => (
              <tr key={i.id}><td>{dmy(i.date)}</td><td>{i.statementNo ?? '—'}</td><td>{i.desc.slice(0, 70)}</td><td className="n">{fmt(i.amount)}</td><td>{byLbl[i.by]}</td>
                <td>{i.skipped && <span className="pill warn">заклучен период</span>}</td></tr>
            ))}</tbody>
          </table></div>
          {todo.length > 0 && (
            <RowAction className="btn pri" showOk action={moveTransitAction} label={`↻ Префрли постоечки ставки ${mv.from} → ${mv.to} (${todo.length})`}
              confirm={`Да се префрлат ${todo.length} ставки (пренос меѓу сопствени сметки) од ${mv.from} на ${mv.to} и да се прекнижат ${mv.statements} изводи за ${year}? Уплатите на дневен промет остануваат на ${mv.from}.`} />
          )}
        </details>
      )}

      <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
        <RowAction className="btn" showOk action={repostLayoutAction} label={P.layout === 'sum' ? '↻ Прекнижи ги изводите збирно' : '↻ Прекнижи ги изводите по ставка'}
          confirm={`Да се прекнижат сите изводи за ${year} (${P.layout === 'sum' ? 'банкарското конто збирно, еднаш Д / П' : 'банкарското конто до секоја ставка'})? Изводите во заклучен период се прескокнуваат.`} />
        <span className="note">Налогот го задржува бројот и врската со изводот; салдото на банкарското конто не се менува.</span>
      </div>
    </div>
  );
}
