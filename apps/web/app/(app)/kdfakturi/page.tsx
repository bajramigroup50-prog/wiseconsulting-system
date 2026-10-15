/**
 * „🧾 Месечна фактура за сметководствени услуги“ (new, office OWNER only — like the contracts): the office firm
 * (БАЈРАМИ ГРОУП, „Фирма на канцеларијата“) invoices every client with a contract fee for the month in one click
 * (or automatically on the billing day), in its own invoice series, booked; the PDF goes to the client portal and by
 * e-mail. Preview before issuing; clients without a fee are skipped; a client with the old recurring definition is
 * shown („периодична“) and billed only when ticked (the definition is then switched off — never twice).
 * Payment from the office firm's bank statements; polite reminders after N days.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FEE_ST_PILL, feeBillingDate, feeMonth, feeToIssue, feeTotals } from '@wise/core/firms/kdfee';
import { rokYmAdd } from '@wise/core/office/rokovi';
import { feeContext, feePreview, feeRows } from '@wise/db';
import { isDemoUser } from '@/lib/demo';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { today } from '@/lib/office';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { fmt } from '@/lib/fmt';
import { ActionForm } from '@/components/action-form';
import { Hd, dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { issueFeeAction, redeliverFeeAction, remindFeeAction, saveFeeSettings } from './actions';
import { kdOwnerUser } from '../kdogovori/lib';

const T = '🧾 Месечна фактура за сметководствени услуги';
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const c2 = (c: number) => fmt(c / 100);

export default async function KdFakturiPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const u = await kdOwnerUser();
  if (!u) {
    const u0 = await requireUser();
    if (u0.role === 'klient' || u0.role === 'teren') notFound();
    return <><Hd t={T} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  }
  const sp = await searchParams;
  const td = today();
  const ym = sp.m && YM.test(sp.m) ? sp.m : td.slice(0, 7);
  // 🎭 a demo admin: the demo office firm → demo firms only (never the real office or its clients)
  const demo = isDemoUser(u);
  const pv = await feePreview(db(), ym, await feeContext(db(), { demo }));
  if (!pv) {
    return (
      <>
        <Hd t={T} exp={false} />
        <div className="callout warn">Прво одредете ја „Фирмата на канцеларијата“ (давател на услугата) во <Link href="/kdogovori">✍ Договор за сметководствени услуги</Link> – од неа се издаваат фактурите.</div>
      </>
    );
  }
  const { ctx, plan, noFee } = pv;
  const S = ctx.S;
  const todo = feeToIssue(plan, { includeRecurring: true });
  const tNew = feeTotals(plan.filter((r) => r.st === 'нова'));
  const bill = feeBillingDate(ym, S.day ?? 'L');
  const months = [...new Set([ym, rokYmAdd(ym, -1), rokYmAdd(ym, -2), rokYmAdd(ym, -3), rokYmAdd(ym, -4), rokYmAdd(ym, -5)])];
  const issued = await feeRows(db(), { offId: ctx.off.id, periods: months });
  const open = issued.filter((r) => r.remaining > 100);
  const q = (m: string) => `/kdfakturi?m=${m}`;

  return (
    <>
      <Hd t={T} sub={`${ctx.off.name} → клиенти · ${feeMonth(ym)} · ДДВ ${ctx.rate}%`}>
        <Link className="btn sm" href={q(rokYmAdd(ym, -1))}>◀</Link>
        <Link className="btn sm" href={q(rokYmAdd(ym, 1))}>▶</Link>
        <Link className="btn" href="/kdogovori">✍ Договори</Link>
      </Hd>
      {S.auto && <div className="callout">🤖 Автоматски: фактурите за месецот се издаваат на {S.day === 'L' || !S.day ? 'последниот работен ден' : `${S.day}-ти`} ({dmy(bill)}) во 06:40.</div>}

      <ActionForm action={issueFeeAction} className="card" reset={false}>
        <div className="hd"><h2>Преглед пред издавање – {feeMonth(ym)}</h2>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input type="hidden" name="ym" value={ym} />
            <label>Датум на фактурите <input type="date" name="date" defaultValue={td < bill && td.slice(0, 7) === ym ? td : bill} required /></label>
            <button className="btn pri" disabled={!todo.length}>🧾 Издади ги означените</button>
          </div>
        </div>
        <div className="tw"><table className="dense">
          <thead><tr><th /><th>Клиент</th><th>Договор</th><th className="n">Без ДДВ</th><th className="n">ДДВ</th><th className="n">Вкупно</th><th>Состојба</th></tr></thead>
          <tbody>{plan.length ? plan.map((r) => (
            <tr key={r.firmId}>
              <td>{(r.st === 'нова' || r.st === 'периодична') && <input type="checkbox" name="only" value={r.firmId} defaultChecked={r.st === 'нова'} aria-label={`Издади за ${r.name}`} />}</td>
              <td>{r.name}{!r.partnerId && r.st === 'нова' && <div className="mini">купувачот ќе се отвори во {ctx.off.name}</div>}</td>
              <td className="mini">{r.no}</td>
              <td className="n">{c2(r.net)}</td><td className="n">{c2(r.vat)}</td><td className="n"><b>{c2(r.gross)}</b></td>
              <td><span className={`pill ${FEE_ST_PILL[r.st]}`}>{r.st}</span>{r.issued?.number && <span className="mini"> бр. {r.issued.number}</span>}
                {r.st === 'периодична' && <div className="mini">има периодична фактура – ако ја означите, периодичната се исклучува</div>}</td>
            </tr>
          )) : <tr><td colSpan={7} className="empty">Нема клиенти со надомест во договорот.</td></tr>}</tbody>
          {tNew.gross > 0 && <tfoot><tr><td /><td colSpan={2}><b>Нови ({plan.filter((r) => r.st === 'нова').length})</b></td><td className="n">{c2(tNew.net)}</td><td className="n">{c2(tNew.vat)}</td><td className="n"><b>{c2(tNew.gross)}</b></td><td /></tr></tfoot>}
        </table></div>
        {noFee > 0 && <div className="mini">Прескокнати {noFee} клиенти без надомест во договорот.</div>}
      </ActionForm>

      <div className="card"><h2>Издадени фактури (последни 6 месеци) · неплатени {open.length}{open.length ? ` · ${c2(open.reduce((s, r) => s + r.remaining, 0))} ден.` : ''}</h2>
        <div className="tw"><table className="dense">
          <thead><tr><th>Месец</th><th>Клиент</th><th>Број</th><th>Датум</th><th>Рок</th><th className="n">Износ</th><th className="n">Платено</th><th className="n">Останува</th><th>Испратено</th><th>Потсетници</th><th /></tr></thead>
          <tbody>{issued.length ? issued.map((r) => {
            const late = r.remaining > 100 && r.due < td;
            return (
              <tr key={r.id}>
                <td>{r.period}</td><td>{r.client}</td><td>{r.number}</td><td>{dmy(r.date)}</td>
                <td>{late ? <span className="pill bad">{dmy(r.due)}</span> : dmy(r.due)}</td>
                <td className="n">{c2(r.gross)}</td><td className="n">{c2(r.paid)}</td>
                <td className="n">{r.remaining > 100 ? <b>{c2(r.remaining)}</b> : <span className="pill good">платена</span>}</td>
                <td className="mini">{[r.portal ? 'портал' : '', r.mailedAt ? 'е-пошта' : ''].filter(Boolean).join(' · ') || '—'}</td>
                <td className="mini">{r.reminders ? `${r.reminders} · ${dmy(r.lastReminder)}` : ''}</td>
                <td className="noprint" style={{ whiteSpace: 'nowrap' }}>
                  {!demo && r.remaining > 100 && <RowAction action={remindFeeAction.bind(null, r.id)} label="✉ Потсетник" confirm={`Да се испрати љубезен потсетник до ${r.client}?`} />}
                  {!demo && <RowAction action={redeliverFeeAction.bind(null, r.id)} label="↻" title="Испрати ја фактурата пак (портал / е-пошта)" />}
                </td>
              </tr>
            );
          }) : <tr><td colSpan={11} className="empty">Сè уште нема издадени фактури.</td></tr>}</tbody>
        </table></div>
        <div className="mini">Плаќањето се гледа од изводите на {ctx.off.name} (поврзани со фактурата). Неплатените: и во <Link href="/opomeni">⏰ Неплатени фактури и опомени</Link> на фирмата на канцеларијата.</div>
      </div>

      <details className="card">
        <summary><b>⚙ Поставки</b> <span className="mini">— {S.auto ? 'автоматски' : 'рачно'} · {S.remind?.on ? `потсетник по ${S.remind.days} дена, на секои ${S.remind.every}, најмногу ${S.remind.max}` : 'без потсетници'}</span></summary>
        <ActionForm action={saveFeeSettings} className="" reset={false}>
          <div className="row" style={{ gap: '8px 16px', flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <label>Ден на фактурирање <select name="day" defaultValue={String(S.day ?? 'L')} style={{ width: 'auto' }}>
              <option value="L">последен работен ден</option>{Array.from({ length: 28 }, (_, i) => <option key={i} value={String(i + 1)}>{i + 1}-ти</option>)}</select></label>
            <label className="chk"><input type="checkbox" name="auto" defaultChecked={!!S.auto} /> издавај автоматски на денот на фактурирање</label>
            <label className="chk"><input type="checkbox" name="portal" defaultChecked={S.portal !== false} /> PDF во порталот на клиентот</label>
            <label className="chk"><input type="checkbox" name="mail" defaultChecked={S.mail !== false} /> PDF по е-пошта (кога е подесена е-поштата)</label>
          </div>
          <div className="row" style={{ gap: '8px 16px', flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <label className="chk"><input type="checkbox" name="rOn" defaultChecked={!!S.remind?.on} /> љубезен потсетник за неплатените</label>
            <label><input type="number" name="rDays" min={1} max={120} defaultValue={S.remind?.days ?? 10} style={{ width: 60 }} /> дена по рокот</label>
            <label>на секои <input type="number" name="rEvery" min={1} max={120} defaultValue={S.remind?.every ?? 15} style={{ width: 60 }} /> дена</label>
            <label>најмногу <input type="number" name="rMax" min={1} max={10} defaultValue={S.remind?.max ?? 3} style={{ width: 50 }} /></label>
            <button className="btn pri">Зачувај</button>
          </div>
        </ActionForm>
      </details>
    </>
  );
}
