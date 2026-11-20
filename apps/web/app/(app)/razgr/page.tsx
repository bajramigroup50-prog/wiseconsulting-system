/**
 * 📆 Временски разграничувања – распоред по месеци за однапред платени трошоци (осигурување, закуп, лиценци…) и
 * однапред наплатени приходи (годишни претплати). Every month: Д трошок / П 1909, or Д 2930 / П приход, dated the
 * month end (`@wise/core/deferrals`, `@wise/db` `postDeferralsDue`).
 */
import Link from 'next/link';
import { DEFERRAL_KONTO, deferralTo, type DeferralState } from '@wise/core/deferrals';
import { deferralStates } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { today } from '@/lib/finance';
import { ActionForm, Submit } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteDeferralAction, postDeferralsAction, saveDeferralAction, stopDeferralAction, undoDeferralMonthAction } from './actions';

const ymL = (ym: string) => `${ym.slice(5)}.${ym.slice(0, 4)}`;

export default async function RazgrPage({ searchParams }: { searchParams: Promise<{ m?: string; edit?: string; nov?: string; d?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('razgr');
  if (!firm) return <NoFirm t="Временски разграничувања" />;
  const td = today();
  const upto = sp.m && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : td.slice(0, 7);
  const S = await db().transaction((tx) => deferralStates(tx, firm.id, upto));
  const write = canDo(u, 'deferralPost', firm.id);
  const del = canDo(u, 'nalDel', firm.id);
  const edit = sp.edit ? S.find((s) => s.d.id === sp.edit)?.d : undefined;
  const showForm = write && (sp.nov !== undefined || !!edit);
  const dueN = S.reduce((a, s) => a + s.due.length, 0);
  const dueAmt = S.reduce((a, s) => a + s.due.reduce((b, p) => b + p.amount, 0), 0);
  const open = S.filter((s) => s.remaining > 0.004);
  const rest = (k: 'cost' | 'income') => open.filter((s) => s.d.kind === k).reduce((a, s) => a + s.remaining, 0);
  return (
    <>
      <Hd t="📆 Временски разграничувања" sub="распоред по месеци" excel={false}>
        {write && <Link className="btn pri" href="/razgr?nov">+ Нов распоред</Link>}
      </Hd>
      <p className="note">Кога трошокот е платен однапред за повеќе месеци (годишно осигурување, закуп, лиценца, претплата), фактурата се книжи на <b>{DEFERRAL_KONTO.cost}</b> Однапред платени трошоци, а секој месец програмата пренесува еднаков дел на трошокот (Д 4xxx / П {DEFERRAL_KONTO.cost}). Однапред наплатен приход: фактурата на <b>{DEFERRAL_KONTO.income}</b>, секој месец Д {DEFERRAL_KONTO.income} / П 7xxx. Налогот е со датум на последниот ден од месецот; секој месец може да се поништи посебно.</p>

      {showForm && (
        <ActionForm action={saveDeferralAction} className="card" reset={!edit}>
          <h2>{edit ? 'Измени распоред' : 'Нов распоред'}</h2>
          {edit && <input type="hidden" name="id" value={edit.id} />}
          <div className="form">
            <label className="f">Опис<input name="name" required defaultValue={edit?.name} placeholder="на пр. Осигурување на возила 2027" /></label>
            <label className="f">Вид<select name="kind" defaultValue={edit?.kind ?? (sp.d === 'income' ? 'income' : 'cost')}>
              <option value="cost">Трошок платен однапред (Д 4xxx / П {DEFERRAL_KONTO.cost})</option>
              <option value="income">Приход наплатен однапред (Д {DEFERRAL_KONTO.income} / П 7xxx)</option>
            </select></label>
            <label className="f">Вкупен износ (ден.)<input name="amount" required inputMode="decimal" defaultValue={edit ? String(edit.amount) : ''} /></label>
            <label className="f">Од месец<input name="from" type="month" required defaultValue={edit?.from ?? td.slice(0, 7)} /></label>
            <label className="f">Број на месеци<input name="months" type="number" min={1} max={120} required defaultValue={edit?.months ?? 12} /></label>
            <label className="f">Конто на трошокот / приходот<input name="konto" required inputMode="numeric" defaultValue={edit?.konto} placeholder="4490 / 7400" /></label>
            <label className="f">Конто за разграничување<input name="defKonto" required inputMode="numeric" defaultValue={edit?.defKonto ?? DEFERRAL_KONTO.cost} placeholder={`${DEFERRAL_KONTO.cost} / ${DEFERRAL_KONTO.income}`} /></label>
            <label className="f">Документ (фактура бр.)<input name="doc" defaultValue={edit?.doc ?? ''} /></label>
          </div>
          <p className="note">За приход сменете го контото за разграничување на {DEFERRAL_KONTO.income}. Ако распоредот веќе има книжени месеци, може да се менуваат само описот и документот.</p>
          <div className="row"><Link className="btn" href="/razgr">Откажи</Link><Submit>Зачувај</Submit></div>
        </ActionForm>
      )}

      <div className="card row" style={{ gap: '6px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <form className="row" style={{ gap: 6 }}>
          <label>Книжи до месец <input type="month" name="m" defaultValue={upto} /></label>
          <button className="btn">↻ Провери</button>
        </form>
        <span>За книжење: <b>{dueN}</b> месеци · <b>{fmt(dueAmt)}</b> ден.</span>
        {write && dueN > 0 && <RowAction className="btn pri" inline action={postDeferralsAction.bind(null, upto, undefined)} label={`Книжи ги сите до ${ymL(upto)}`}
          confirm={`Да се книжат ${dueN} месеци (${fmt(dueAmt)} ден.) до ${ymL(upto)}? Секој месец е посебен налог.`} />}
        <span className="mini">Останато за пренос: трошоци {fmt(rest('cost'))} · приходи {fmt(rest('income'))} ден.</span>
      </div>

      {S.length ? S.map((s) => <Schedule key={s.d.id} s={s} upto={upto} write={write} del={del} />)
        : <div className="card empty">Нема распореди. {write && <Link className="btn sm" href="/razgr?nov">+ Нов распоред</Link>}</div>}
    </>
  );
}

function Schedule({ s, upto, write, del }: { s: DeferralState; upto: string; write: boolean; del: boolean }) {
  const { d } = s;
  const booked = s.parts.filter((p) => p.posted).length;
  return (
    <details className="card" open={s.due.length > 0}>
      <summary style={{ cursor: 'pointer' }}>
        <b>{d.name}</b> <span className="pill">{d.kind === 'cost' ? 'трошок' : 'приход'}</span>{d.stopped && <> <span className="pill warn">запрен</span></>}
        {' '}· {fmt(d.amount)} ден. · {ymL(d.from)}–{ymL(deferralTo(d))} · {d.kind === 'cost' ? `Д ${d.konto} / П ${d.defKonto}` : `Д ${d.defKonto} / П ${d.konto}`}
        {' '}· книжено {booked}/{d.months} ({fmt(s.posted)}) · останато <b>{fmt(s.remaining)}</b>
        {s.due.length > 0 && <> · <span className="pill bad">{s.due.length} за книжење</span></>}
      </summary>
      <div className="row" style={{ gap: 6, margin: '8px 0' }}>
        {write && s.due.length > 0 && <RowAction className="btn sm pri" inline action={postDeferralsAction.bind(null, upto, d.id)} label={`Книжи ${s.due.length} месеци`} />}
        {write && <Link className="btn sm" href={`/razgr?edit=${d.id}`}>Измени</Link>}
        {write && <RowAction className="btn sm" action={stopDeferralAction.bind(null, d.id, !d.stopped)} label={d.stopped ? 'Продолжи' : 'Запри'}
          confirm={d.stopped ? undefined : `Да се запре „${d.name}“? Нема да се книжат понатамошни месеци (на пр. договорот е раскинат). Остатокот од ${fmt(s.remaining)} ден. останува на ${d.defKonto} – книжете го рачно.`} />}
        {del && !booked && <RowAction className="btn sm ghost danger" action={deleteDeferralAction.bind(null, d.id)} label="🗑" confirm={`Да се избрише распоредот „${d.name}“?`} />}
        {d.doc && <span className="mini">документ: {d.doc}</span>}
      </div>
      <div className="tw"><table className="dense">
        <thead><tr><th>#</th><th>Месец</th><th className="n">Износ</th><th>Статус</th><th /></tr></thead>
        <tbody>{s.parts.map((p) => (
          <tr key={p.ym}><td>{p.no}</td><td>{ymL(p.ym)}</td><td className="n">{fmt(p.amount)}</td>
            <td>{p.posted ? <span className="pill good">✓ книжено</span> : p.ym <= upto && !d.stopped ? <span className="pill bad">за книжење</span> : <span className="mut">—</span>}</td>
            <td>{p.posted && del && <RowAction className="btn sm ghost" action={undoDeferralMonthAction.bind(null, d.id, p.ym)} label="Поништи" confirm={`Да се поништи книжењето за ${ymL(p.ym)}?`} />}</td></tr>
        ))}</tbody>
      </table></div>
    </details>
  );
}
