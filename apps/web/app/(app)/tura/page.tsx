/**
 * Legacy `VIEWS.tura` 11861 → 11958 — Туристичка агенција: arrangements (own = tour operator under the margin scheme,
 * чл. 38; agent = intermediary), costs with linked purchases (no input-VAT deduction), bookings, payments (cash →
 * receipt on the advances konto), invoice through Phase 3 (`tourM` + `arrangementId` for Phase 5 VAT), advance offset.
 */
import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { ARRANGEMENT_STATUS, bookingPaid, bookingPax, bookingTotal, NATIONALITIES, TA_CATEGORIES } from '@wise/core/industry';
import { arrangementsWithResults, firmTravelConfig, invoices, partners, purchases, travelBookings } from '@wise/db';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { bookingPayAction, bookingStepAction, saveArrangementAction, saveBookingAction, saveTravelConfigAction } from './actions';

type SP = { a?: string; b?: string; all?: string; cfg?: string };

export default async function TuraPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const g = await industryPage('tura', 'Туристичка агенција – аранжмани');
  if (g.blocked) return g.blocked;
  const { firm, write } = g;
  const cfg = firmTravelConfig(firm);
  const L = await db().transaction((tx) => arrangementsWithResults(tx, firm));

  if (sp.a) {
    const X = sp.a === 'new' ? null : L.find((x) => x.A.id === sp.a);
    const A = X?.A ?? { id: '', code: '', name: '', dest: '', from: '', to: '', kind: 'own' as const, seats: null, price: null, priceCh: null, comm: null, prog: '', incl: '', excl: '', costs: [], status: 'open' as const, countries: [] };
    const purs = await db().select({ id: purchases.id, number: purchases.number, date: purchases.date, total: purchases.total, p: partners.name }).from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId))
      .where(eq(purchases.firmId, firm.id)).orderBy(desc(purchases.date)).limit(150);
    const costs = [...A.costs, ...Array(3).fill({ cat: TA_CATEGORIES[0], amt: '', cur: 'MKD', fx: 1 })];
    const B = X?.B ?? [];
    let bookingEd: React.ReactNode = null;
    if (sp.b && A.id) {
      const [b0] = sp.b === 'new' ? [] : await db().select().from(travelBookings).where(and(eq(travelBookings.id, sp.b), eq(travelBookings.firmId, firm.id))).limit(1);
      const b = b0 ?? { id: '', number: '', client: { name: '', phone: '', email: '', addr: '' }, partnerId: null, adults: 1, children: 0, extra: null, disc: null, priceTot: null, pax: [], pays: [], room: '', note: '', status: 'resv' as const, invoiceId: null, advanceSettled: null };
      const P = await partnerOptions(firm.id);
      const inv = b.invoiceId ? (await db().select({ n: invoices.number }).from(invoices).where(eq(invoices.id, b.invoiceId)))[0]?.n : null;
      const ro = !write || !!b.invoiceId;
      const tot = bookingTotal(b, A), paid = bookingPaid(b);
      bookingEd = (
        <div className="card" style={{ border: '2px solid var(--accent)' }}>
          <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>{b.id ? `Пријава ${b.number}` : 'Нова пријава'}</h2>
            <div className="row" style={{ gap: 6 }}>{b.id && <Link className="btn sm" href={`/tura/dogovor?id=${b.id}`} target="_blank">🖨 Договор за патување</Link>}<Link className="btn sm" href={`/tura?a=${A.id}`}>Затвори</Link></div></div>
          <BankForm action={saveBookingAction}>
            <input type="hidden" name="id" value={b.id} /><input type="hidden" name="arr" value={A.id} />
            <div className="form">
              <label className="f">Носител<input name="cname" defaultValue={b.client.name} /></label>
              <label className="f">Телефон<input name="cphone" defaultValue={b.client.phone ?? ''} /></label>
              <label className="f">Е-пошта<input name="cemail" defaultValue={b.client.email ?? ''} /></label>
              <label className="f">Адреса<input name="caddr" defaultValue={b.client.addr ?? ''} /></label>
              <label className="f">Фактура на фирма<select name="partner" defaultValue={b.partnerId ?? ''}><option value="">— носителот —</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="f">Возрасни<input name="adults" type="number" defaultValue={b.adults} /></label>
              <label className="f">Деца<input name="children" type="number" defaultValue={b.children} /></label>
              <label className="f">Доплата<input name="extra" type="number" step="any" defaultValue={b.extra ? Number(b.extra) : ''} /></label>
              <label className="f">Попуст<input name="disc" type="number" step="any" defaultValue={b.disc ? Number(b.disc) : ''} /></label>
              <label className="f">Договорена вкупна цена<input name="priceTot" type="number" step="any" defaultValue={b.priceTot ? Number(b.priceTot) : ''} placeholder="од ценовникот" /></label>
              <label className="f">Соба<input name="room" defaultValue={b.room ?? ''} /></label>
              <label className="f wide">Забелешка<input name="note" defaultValue={b.note ?? ''} /></label>
            </div>
            <h3 className="fh" style={{ marginTop: 8 }}>Патници</h3>
            <table className="dense"><thead><tr><th>Име и презиме</th><th>Датум на раѓање</th><th>Државјанство</th><th>Пасош бр.</th><th>Важи до</th></tr></thead>
              <tbody>{[...b.pax, ...Array(3).fill({ name: '' })].map((p, i) => (
                <tr key={i}><td><input name={`p.name.${i}`} defaultValue={p.name} /></td><td><input name={`p.birth.${i}`} type="date" defaultValue={p.birth ?? ''} /></td>
                  <td><select name={`p.nat.${i}`} defaultValue={p.nat ?? 'MK'}>{NATIONALITIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></td>
                  <td><input name={`p.doc.${i}`} defaultValue={p.doc ?? ''} /></td><td><input name={`p.docExp.${i}`} type="date" defaultValue={p.docExp ?? ''} /></td></tr>
              ))}</tbody></table>
            {!ro && <div className="row" style={{ marginTop: 8 }}><span style={{ flex: 1 }} /><button className="btn pri">Зачувај пријава</button></div>}
          </BankForm>
          {b.id && <>
            <h3 className="fh" style={{ marginTop: 10 }}>Уплати · цена {fmt(tot)} · уплатено {fmt(paid)} · остаток {fmt(tot - paid)}</h3>
            <table className="dense"><tbody>{b.pays.map((p, i) => <tr key={i}><td>{dmy(p.date)}</td><td className="n">{fmt(p.amt)}</td><td>{p.how === 'cash' ? `готовина${p.no ? ' · ' + p.no : ''}` : p.how === 'bank' ? 'банка' : 'картичка'}</td>
              <td>{write && !b.advanceSettled && <RowAction action={bookingStepAction.bind(null, b.id, `rm${i}`)} confirm="Да се отстрани уплатата (и уплатницата)?" label="✕" />}</td></tr>)}</tbody></table>
            {write && <BankForm action={bookingPayAction} className="row" style={{ gap: 6, alignItems: 'end', marginTop: 6 }}>
              <input type="hidden" name="id" value={b.id} />
              <label className="f">Датум<input name="date" type="date" defaultValue={today()} /></label>
              <label className="f">Износ<input name="amt" type="number" step="any" defaultValue={Math.max(0, tot - paid) || ''} /></label>
              <label className="f">Начин<select name="how"><option value="cash">готовина (уплатница)</option><option value="bank">банка</option><option value="card">картичка</option></select></label>
              <button className="btn sm">+ Уплата</button>
            </BankForm>}
            {write && <div className="row" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} />
              {!b.invoiceId && b.status !== 'cancel' && <RowAction className="btn ghost" action={bookingStepAction.bind(null, b.id, 'cancel')} confirm={`Да се откаже пријавата ${b.number}? (уплатите остануваат)`} label="Откажи пријава" />}
              {!b.invoiceId && b.status !== 'cancel' && <RowAction className="btn pri" action={bookingStepAction.bind(null, b.id, 'inv')} label="🧾 Фактура" />}
              {b.invoiceId && paid > 0 && !b.advanceSettled && <RowAction className="btn" action={bookingStepAction.bind(null, b.id, 'adv')} label="↔ Пребиј уплати (аванс)" />}
              {inv && <span className="pill good">Фактура {inv}</span>}{b.advanceSettled && <span className="pill good">аванс пребиен {fmt(b.advanceSettled)}</span>}
            </div>}
          </>}
        </div>
      );
    }
    return (
      <>
        <Hd t={A.id ? `${A.code} · ${A.name}` : 'Нов аранжман'} sub={ARRANGEMENT_STATUS[A.status][0]}>
          <Link className="btn" href="/tura">← Аранжмани</Link>
          {A.id && <Link className="btn" href={`/tura/dogovor?arr=${A.id}`} target="_blank">🖨 Програма и патници</Link>}
        </Hd>
        {X && <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          {([['Патници', `${X.R.pax}${A.seats ? ' / ' + A.seats : ''}`], ['Промет', fmt(X.R.rev)], ['Уплатено', fmt(X.R.paid)], ['Трошоци', fmt(X.R.cost)], ['Маржа', fmt(X.R.margin)], ['ДДВ', fmt(X.R.vat)], ['Заработка без ДДВ', fmt(X.R.net)]] as const).map(([t, v]) => (
            <div key={t} className="card" style={{ flex: 1, minWidth: 120, margin: 0 }}><div className="mini">{t}</div><div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div></div>))}
        </div>}
        {bookingEd}
        {A.id && <div className="card"><div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Пријави ({B.filter((b) => b.status !== 'cancel').length})</h2>{write && <Link className="btn sm pri" href={`/tura?a=${A.id}&b=new`}>+ Пријава</Link>}</div>
          <div className="tw"><table className="dense"><thead><tr><th>Број</th><th>Носител</th><th>Телефон</th><th className="n">Патници</th><th className="n">Цена</th><th className="n">Уплатено</th><th className="n">Остаток</th><th>Фактура</th><th /></tr></thead>
            <tbody>{B.map((b) => <tr key={b.id} style={{ opacity: b.status === 'cancel' ? 0.5 : 1 }}><td>{b.number}</td><td>{b.client.name}</td><td>{b.client.phone}</td><td className="n">{bookingPax(b)}</td><td className="n">{fmt(bookingTotal(b, A))}</td><td className="n">{fmt(bookingPaid(b))}</td><td className="n">{fmt(bookingTotal(b, A) - bookingPaid(b))}</td>
              <td>{b.invoiceId ? <span className="pill good">да</span> : b.status === 'cancel' ? <span className="pill">откажана</span> : ''}</td><td><Link className="btn sm" href={`/tura?a=${A.id}&b=${b.id}`}>Отвори</Link></td></tr>)}
              {!B.length && <tr><td colSpan={9} className="note">Нема пријави.</td></tr>}</tbody></table></div></div>}
        <BankForm action={saveArrangementAction} className="card">
          <input type="hidden" name="id" value={A.id} />
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Податоци за аранжманот</h2>
          <div className="form">
            <label className="f">Шифра<input name="code" defaultValue={A.code} placeholder="автоматски" /></label>
            <label className="f wide">Назив<input name="name" defaultValue={A.name} /></label>
            <label className="f">Дестинација<input name="dest" defaultValue={A.dest ?? ''} /></label>
            <label className="f">Земји<input name="countries" defaultValue={A.countries.join(', ')} /></label>
            <label className="f">Поаѓање<input name="from" type="date" defaultValue={A.from ?? ''} /></label>
            <label className="f">Враќање<input name="to" type="date" defaultValue={A.to ?? ''} /></label>
            <label className="f">Вид<select name="kind" defaultValue={A.kind}><option value="own">сопствен (тур-оператор, ДДВ на маржа)</option><option value="agent">посредување (провизија)</option></select></label>
            <label className="f">Места<input name="seats" type="number" defaultValue={A.seats ?? ''} /></label>
            <label className="f">Цена по возрасен<input name="price" type="number" step="any" defaultValue={A.price ? Number(A.price) : ''} /></label>
            <label className="f">Цена по дете<input name="priceCh" type="number" step="any" defaultValue={A.priceCh ? Number(A.priceCh) : ''} /></label>
            <label className="f">Провизија % (посредување)<input name="comm" type="number" step="any" defaultValue={A.comm ? Number(A.comm) : ''} placeholder={String(cfg.comm)} /></label>
            <label className="f">Статус<select name="status" defaultValue={A.status}>{Object.entries(ARRANGEMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></label>
            <label className="f wide">Програма<textarea name="prog" rows={4} defaultValue={A.prog ?? ''} /></label>
            <label className="f wide">Цената вклучува<textarea name="incl" rows={2} defaultValue={A.incl ?? ''} /></label>
            <label className="f wide">Цената не вклучува<textarea name="excl" rows={2} defaultValue={A.excl ?? ''} /></label>
          </div>
          <h3 className="fh" style={{ marginTop: 8 }}>Трошоци (претходни туристички услуги и сопствени услуги)</h3>
          <div className="tw"><table className="dense"><thead><tr><th>Категорија</th><th>Добавувач</th><th>Опис</th><th className="n">Износ</th><th>Валута</th><th className="n">Курс</th><th>или влезна фактура</th></tr></thead>
            <tbody>{costs.map((c, i) => (
              <tr key={i}><td><select name={`c.cat.${i}`} defaultValue={c.cat}>{TA_CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select></td>
                <td><input name={`c.who.${i}`} defaultValue={c.who ?? ''} /></td><td><input name={`c.desc.${i}`} defaultValue={c.desc ?? ''} /></td>
                <td className="n"><input name={`c.amt.${i}`} type="number" step="any" defaultValue={c.amt ?? ''} style={{ width: 100 }} /></td>
                <td><input name={`c.cur.${i}`} defaultValue={c.cur ?? 'MKD'} style={{ width: 60 }} /></td><td className="n"><input name={`c.fx.${i}`} type="number" step="any" defaultValue={c.fx ?? 1} style={{ width: 70 }} /></td>
                <td><select name={`c.purchaseId.${i}`} defaultValue={c.purchaseId ?? ''}><option value="">—</option>{purs.map((p) => <option key={p.id} value={p.id}>{dmy(p.date)} · {p.number} · {p.p} · {fmt(p.total)}</option>)}</select></td></tr>
            ))}</tbody></table></div>
          <p className="note">Сопствен аранжман: ДДВ се пресметува само на маржата (чл. 38 ЗДДВ). Поврзаните влезни фактури автоматски се означуваат „без одбивка на ДДВ“. Посредување: приход е само провизијата (ДДВ 18%), остатокот е наплата за туѓа сметка ({cfg.passKonto}).</p>
          {write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај аранжман</button></div>}
        </BankForm>
      </>
    );
  }

  const list = L.filter((x) => sp.all || (x.A.status !== 'done' && x.A.status !== 'cancel'));
  return (
    <>
      <Hd t="Туристичка агенција – аранжмани" sub={`${list.length} аранжмани`}>
        <Link className="btn" href="/turaIzv">📈 Извештаи</Link>
        <Link className="btn" href={sp.cfg ? '/tura' : '/tura?cfg=1'}>⚙ Поставки</Link>
        {write && <Link className="btn pri" href="/tura?a=new">+ Нов аранжман</Link>}
      </Hd>
      <div className="row" style={{ marginBottom: 8 }}><Link className="mini" href={sp.all ? '/tura' : '/tura?all=1'}>{sp.all ? 'скриј ги реализираните / откажаните' : 'прикажи ги и реализираните / откажаните'}</Link></div>
      <div className="tw"><table><thead><tr><th>Шифра</th><th>Аранжман</th><th>Поаѓање – враќање</th><th>Вид</th><th className="n">Патници</th><th className="n">Промет</th><th className="n">Уплатено</th><th className="n">Трошоци</th><th className="n">Маржа</th><th>Статус</th><th /></tr></thead>
        <tbody>{list.map(({ A, R }) => { const s = ARRANGEMENT_STATUS[A.status]; return (
          <tr key={A.id}><td>{A.code}</td><td><b>{A.name}</b><div className="mini">{A.dest}</div></td><td>{dmy(A.from)} – {dmy(A.to)}</td><td className="mini">{A.kind === 'agent' ? 'посредување' : 'сопствен (тур-оператор)'}</td>
            <td className="n">{R.pax}{A.seats ? ' / ' + A.seats : ''}</td><td className="n">{fmt(R.rev)}</td><td className="n">{fmt(R.paid)}</td><td className="n">{fmt(R.cost)}</td><td className="n" style={{ color: R.margin < 0 ? 'var(--bad)' : undefined }}><b>{fmt(R.margin)}</b></td>
            <td><span className={`pill ${s[1]}`}>{s[0]}</span></td><td><Link className="btn sm" href={`/tura?a=${A.id}`}>Отвори</Link></td></tr>); })}
          {!list.length && <tr><td colSpan={11} className="note">Нема аранжмани. Креирајте нов аранжман (патување), потоа внесувајте пријави на патници и уплати.</td></tr>}</tbody></table></div>
      {sp.cfg && (
        <BankForm action={saveTravelConfigAction} className="card">
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Поставки – туристичка агенција</h2>
          <div className="form">
            <label className="f">Лиценца бр. (А / Б)<input name="lic" defaultValue={cfg.lic} /></label>
            <label className="f">Конто приход<input name="revK" defaultValue={cfg.revK} placeholder="од шемата (услуги)" /></label>
            <label className="f">Конто аванси од патници<input name="advK" defaultValue={cfg.advK} placeholder="од шемата (аванси)" /></label>
            <label className="f">Конто наплата за туѓа сметка<input name="passKonto" defaultValue={cfg.passKonto} /></label>
            <label className="f">Основица на маржа (чл. 38 ст. 3)<select name="agg" defaultValue={cfg.agg}><option value="period">збирно за сите услуги во даночниот период</option><option value="arr">по групи – секој аранжман посебно</option></select></label>
            <label className="f">Провизија % (стандардна)<input name="comm" type="number" step="any" defaultValue={cfg.comm} /></label>
            <label className="f wide">Гаранција / осигурување на патниците<input name="guar" defaultValue={cfg.guar} /></label>
            <label className="f wide">Општи услови на патување<textarea name="terms" rows={7} defaultValue={cfg.terms} /></label>
          </div>
          {write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>}
        </BankForm>
      )}
      <p className="note">Сопствен аранжман (тур-оператор): ДДВ се пресметува само на маржата – разликата меѓу тоа што плаќа патникот и трошоците за претходните туристички услуги (чл. 38 од Законот за ДДВ), без право на одбивка на ДДВ од тие фактури. Посредување: приход е само провизијата (ДДВ 18%).</p>
    </>
  );
}
