/**
 * Лојалност и купони — legacy `VIEWS.lojalnost` 9943, `lcNew/lcSave`, `cpNew/cpSave`, `loyCfgSave`: loyalty cards
 * (points, permanent discount, spend, visits), coupons (percent / amount, validity, uses, minimum) and the points rules.
 * The POS discount logic is `@wise/core` `Retail.posDiscount` / `couponCheck`, persisted with `loyaltyApplySale`.
 */
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { Retail } from '@wise/core';
import { coupons, loyaltyCards, loyaltyRulesOf } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { settingsOf } from '@/lib/retail';
import { dmy, fmt, fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ActionForm } from '@/components/action-form';
import { loyCfgAction, saveCardAction, saveCouponAction } from '../_retail/actions';

type SP = { t?: string; ed?: string; nov?: string };

export default async function LojalnostPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('lojalnost');
  if (!firm) return <NoFirm t="Лојалност и купони" />;
  const write = canDo(u, 'lcSave', firm.id);
  const T = sp.t === 'cp' || sp.t === 'cfg' ? sp.t : 'cards';
  const [C, P] = await Promise.all([
    db().select().from(loyaltyCards).where(eq(loyaltyCards.firmId, firm.id)).orderBy(desc(loyaltyCards.spent)),
    db().select().from(coupons).where(eq(coupons.firmId, firm.id)).orderBy(desc(coupons.createdAt)),
  ]);
  const Lr = loyaltyRulesOf(settingsOf(firm));
  const tab = (k: string, n: string) => <Link className={`btn ${T === k ? 'pri' : ''}`} href={`/lojalnost?t=${k}`}>{n}</Link>;
  const E = T === 'cards' ? (sp.ed ? C.find((c) => c.id === sp.ed) : sp.nov !== undefined ? null : undefined) : undefined;
  const Q = T === 'cp' ? (sp.ed ? P.find((c) => c.id === sp.ed) : sp.nov !== undefined ? null : undefined) : undefined;
  return (
    <>
      <Hd t="Лојалност и купони" sub={`${C.length} картички · ${P.length} купони`}><Link className="btn" href="/kasa">💶 Каса</Link></Hd>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>{tab('cards', '💳 Картички')}{tab('cp', '🎟 Купони')}{tab('cfg', '⚙ Правила')}</div>
      {T === 'cards' && <>
        {write && E !== undefined ? (
          <ActionForm action={saveCardAction} className="card" reset={false}>
            <input type="hidden" name="id" value={E?.id ?? ''} />
            <div className="form">
              <label className="f">Број на картичка (баркод)<input name="number" defaultValue={E?.number ?? Retail.newCardNo()} /></label>
              <label className="f">Име и презиме<input name="name" defaultValue={E?.name ?? ''} /></label>
              <label className="f">Телефон<input name="phone" defaultValue={E?.phone ?? ''} /></label>
              <label className="f">Е-пошта<input name="email" defaultValue={E?.email ?? ''} /></label>
              <label className="f">Постојан попуст %<input name="discount" inputMode="decimal" defaultValue={E && Number(E.discount) ? String(Number(E.discount)) : ''} /></label>
              <label className="f">Поени<input name="points" inputMode="decimal" defaultValue={String(Number(E?.points ?? 0))} /></label>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} /><Link className="btn" href="/lojalnost">Откажи</Link><button className="btn pri">Зачувај</button></div>
          </ActionForm>
        ) : write && <div className="row" style={{ marginBottom: 8 }}><Link className="btn pri" href="/lojalnost?nov">+ Нова картичка</Link></div>}
        <div className="tw"><table className="dense">
          <thead><tr><th>Картичка</th><th>Име</th><th>Телефон</th><th className="n">Поени</th><th className="n">Попуст</th><th className="n">Потрошено</th><th className="n">Посети</th><th>Последна</th><th /></tr></thead>
          <tbody>{C.map((c) => <tr key={c.id}><td>{c.number}</td><td>{c.name}</td><td>{c.phone}</td><td className="n">{fq(c.points)}</td><td className="n">{Number(c.discount) ? Number(c.discount) + '%' : ''}</td><td className="n">{fmt(c.spent)}</td><td className="n">{c.visits}</td><td>{dmy(c.lastVisit)}</td>
            <td>{write && <Link className="btn sm" href={`/lojalnost?ed=${c.id}`}>Измени</Link>}</td></tr>)}
            {!C.length && <tr><td colSpan={9} className="note">Нема картички.</td></tr>}</tbody>
        </table></div>
      </>}
      {T === 'cp' && <>
        {write && Q !== undefined ? (
          <ActionForm action={saveCouponAction} className="card" reset={false}>
            <input type="hidden" name="id" value={Q?.id ?? ''} />
            <div className="form">
              <label className="f">Код<input name="code" defaultValue={Q?.code ?? ''} style={{ textTransform: 'uppercase' }} /></label>
              <label className="f">Вид<select name="kind" defaultValue={Q?.kind ?? 'pct'}><option value="pct">процент %</option><option value="amt">износ ден.</option></select></label>
              <label className="f">Вредност<input name="value" inputMode="decimal" defaultValue={Q ? String(Number(Q.value)) : ''} /></label>
              <label className="f">Важи од<input name="validFrom" type="date" defaultValue={Q?.validFrom ?? ''} /></label>
              <label className="f">Важи до<input name="validTo" type="date" defaultValue={Q?.validTo ?? ''} /></label>
              <label className="f">Максимум користења (0 = неограничено)<input name="maxUses" inputMode="numeric" defaultValue={String(Q?.maxUses ?? 1)} /></label>
              <label className="f">Минимален износ на сметка<input name="minTotal" inputMode="decimal" defaultValue={Q && Number(Q.minTotal) ? String(Number(Q.minTotal)) : ''} /></label>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} /><Link className="btn" href="/lojalnost?t=cp">Откажи</Link><button className="btn pri">Зачувај</button></div>
          </ActionForm>
        ) : write && <div className="row" style={{ marginBottom: 8 }}><Link className="btn pri" href="/lojalnost?t=cp&nov">+ Нов купон</Link></div>}
        <div className="tw"><table className="dense">
          <thead><tr><th>Код</th><th>Попуст</th><th>Важи</th><th className="n">Искористен</th><th /></tr></thead>
          <tbody>{P.map((c) => <tr key={c.id}><td><b>{c.code}</b></td><td>{c.kind === 'pct' ? Number(c.value) + '%' : fmt(c.value) + ' ден.'}{Number(c.minTotal) ? ` (над ${fmt(c.minTotal)})` : ''}</td><td>{dmy(c.validFrom)} – {dmy(c.validTo)}</td><td className="n">{c.used}{c.maxUses ? ' / ' + c.maxUses : ''}</td>
            <td>{write && <Link className="btn sm" href={`/lojalnost?t=cp&ed=${c.id}`}>Измени</Link>}</td></tr>)}
            {!P.length && <tr><td colSpan={5} className="note">Нема купони.</td></tr>}</tbody>
        </table></div>
      </>}
      {T === 'cfg' && (
        <ActionForm action={loyCfgAction} className="card" reset={false}>
          <div className="form">
            <label className="f">1 поен на секои (ден. потрошени)<input name="per" inputMode="numeric" defaultValue={Lr.per} /></label>
            <label className="f">Вредност на 1 поен (ден.)<input name="val" inputMode="decimal" defaultValue={Lr.val} /></label>
            <label className="f">Минимум поени за користење<input name="min" inputMode="numeric" defaultValue={Lr.min} /></label>
          </div>
          {write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>}
          <p className="note">Во касата: скенирајте ја картичката (или внесете телефон) и/или купон пред „Евидентирај продажба“. Попустот се распределува на ставките (цената на фискалната сметка е намалена), поените се додаваат на платениот износ.</p>
        </ActionForm>
      )}
    </>
  );
}
