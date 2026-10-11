/**
 * Legacy `VIEWS.rent` 9766 + editor `rcEditor` 9777 → 11664 — Rent-a-car: 21-day fleet calendar, active and future
 * rentals; contract editor: vehicle, dates, agreed price, deposit, payer, customer / driver with the passport / ID /
 * driving-licence scan (AI read, copies kept), nationality, ЕМБГ, document and licence data, emergency contact,
 * additional driver, countries of travel (green card, exit authorisation), warnings, extras; handover / return with
 * km, fuel eighths, damages, photos and the customer's signature; deposit received / settled; invoice; contract print
 * (1 or 2 copies, with the handover record).
 */
import Link from 'next/link';
import { and, asc, eq, ne } from 'drizzle-orm';
import {
  addDays, rcCalc, rcDocToDriver, RENT_COUNTRIES, RENT_EXTRAS, RENT_STATUS, rentAbroad, rentAgeConfirm, rentalsOverlap, rentCalcLabel, rentCountryName, rentWarnings,
} from '@wise/core/industry';
import { firmRentConfig, fleetVehicles, invoices, rentRentals, vehicleRates, type RentRental } from '@wise/db';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { loadAiResult } from '@/lib/ai';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, nowLocal, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { DateJump } from '@/components/hotel-rent';
import { PhotoField, SignaturePad } from '@/components/driver-form';
import { RentDocScan } from '@/components/rent-doc-scan';
import { handoverAction, rentalStepAction, saveRentalAction, settleDepositAction } from './actions';

type SP = { id?: string; nov?: string; veh?: string; d?: string; from?: string; scan?: string };
const st = (r: Pick<RentRental, 'status' | 'invoiceId'>) => (r.status === 'ret' && r.invoiceId ? 'closed' : r.status);
const dt = (s: string) => s.replace('T', ' ');
const NAT = ['Македонија', 'Албанија', 'Косово', 'Србија', 'Бугарија', 'Грција', 'Турција', 'Германија', 'Швајцарија', 'Австрија', 'Италија'];

export default async function RentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const g = await industryPage('rent', 'Rent-a-car – резервации');
  if (g.blocked) return g.blocked;
  const { firm, write } = g;
  const C = firmRentConfig(firm);
  const F = await db().select().from(fleetVehicles).where(and(eq(fleetVehicles.firmId, firm.id), eq(fleetVehicles.rent, true), eq(fleetVehicles.active, true))).orderBy(asc(fleetVehicles.plate));
  const T = today();

  if (sp.id || sp.nov) {
    const [E0] = sp.id ? await db().select().from(rentRentals).where(and(eq(rentRentals.id, sp.id), eq(rentRentals.firmId, firm.id))).limit(1) : [];
    const v0 = F.find((v) => v.id === (sp.veh ?? E0?.vehicleId)) ?? F[0];
    const from = (sp.d ?? T) + 'T09:00';
    const E = E0 ?? { id: '', number: '', vehicleId: v0?.id ?? '', plate: v0?.plate ?? '', from, to: addDays(from.slice(0, 10), 3) + 'T09:00', driver: { name: '' } as RentRental['driver'], driver2: '', partnerId: null,
      deposit: v0?.rDep ?? null, extras: [], status: 'resv' as const, note: '', out: { fuel: 8 } as RentRental['out'], ret: {} as RentRental['ret'], pDay: null, priceTot: null, countries: ['MK'], green: false, invoiceId: null, depositVoucherId: null, depositKept: null, depositClosed: false };
    const v = F.find((x) => x.id === E.vehicleId) ?? (E.vehicleId ? (await db().select().from(fleetVehicles).where(eq(fleetVehicles.id, E.vehicleId)).limit(1))[0] : undefined);
    if (!F.length && !E0) return <div className="callout warn">Нема возила за изнајмување: во <Link href="/flota">🚙 Флота и цени</Link> означете ги возилата и внесете цени.</div>;
    // legacy `rcScanDoc`: a finished read prefills the customer fields (only what was read)
    const scan = sp.scan ? (await loadAiResult(firm.id, sp.scan, 'rcdoc')) ?? (await loadAiResult(firm.id, sp.scan, 'rclic')) : null;
    const rd = scan ? rcDocToDriver(scan.result, scan.kind === 'rclic') : null;
    const d = { ...E.driver, ...(rd?.set ?? {}) } as RentRental['driver'];
    const k = v ? rcCalc(E, vehicleRates(v), C) : null;
    const P = await partnerOptions(firm.id);
    const inv = E.invoiceId ? (await db().select({ n: invoices.number, t: invoices.total, st: invoices.status }).from(invoices).where(eq(invoices.id, E.invoiceId)))[0] : null;
    const others = E.vehicleId ? await db().select().from(rentRentals).where(and(eq(rentRentals.firmId, firm.id), eq(rentRentals.vehicleId, E.vehicleId), ne(rentRentals.status, 'cancel'))) : [];
    const clash = others.find((o) => o.id !== E.id && !o.invoiceId && rentalsOverlap(E, o));
    const W = rentWarnings({ ...E, driver: d }, v ?? null, C, clash ? { number: clash.number, driverName: clash.driver.name } : null);
    const ro = !write || !!E.invoiceId || E.status === 'cancel';
    const s = RENT_STATUS[st(E)];
    const ct = E.countries.length ? E.countries : ['MK'];
    const age = rentAgeConfirm(d, E.from, C);
    const scans = [...(d.scans ?? []), ...(scan?.fileId ? [scan.fileId] : [])];
    const hand = (kind: 'out' | 'ret') => {
      const o = E[kind] ?? {};
      const dis = (kind === 'out' && E.status !== 'resv') || (kind === 'ret' && E.status !== 'out') || !write || !E.id;
      const title = kind === 'out' ? '🔑 Предавање на возилото' : '↩ Враќање на возилото';
      if (dis) return (
        <div className="card" style={{ flex: 1, minWidth: 300 }}><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{title}{o.at ? ` · ${dt(String(o.at)).slice(0, 16)}` : ''}</h2>
          <div className="mini">Км: <b>{o.km ?? '—'}</b> · Гориво: <b>{o.fuel != null && o.fuel !== '' ? `${o.fuel}/8` : '—'}</b>{o.dmg ? <> · Оштетувања / забелешки: {o.dmg}</> : null}</div>
          {(o.photos ?? []).length > 0 && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>{o.photos!.map((p) => <a key={p} href={`/api/files/${p}`} target="_blank" rel="noopener noreferrer"><img src={`/api/files/${p}`} alt="" style={{ width: 84, height: 64, objectFit: 'cover', border: '1px solid var(--line)', borderRadius: 4 }} /></a>)}</div>}
          {o.sig && <div className="mini" style={{ marginTop: 6 }}>Потпис на корисникот:<br /><img src={`/api/files/${o.sig}`} alt="" style={{ height: 50, background: '#fff', border: '1px solid var(--line)' }} /></div>}
        </div>);
      return (
        <BankForm action={handoverAction} className="card" style={{ flex: 1, minWidth: 300 }} confirm={kind === 'out' ? age ?? undefined : undefined}>
          <input type="hidden" name="id" value={E.id} /><input type="hidden" name="kind" value={kind} />
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{title}</h2>
          <div className="form">
            <label className="f">Км<input name="km" type="number" defaultValue={kind === 'out' ? (o.km ?? v?.odo ?? '') : ''} /></label>
            <label className="f">Гориво (осмини)<select name="fuel" defaultValue={kind === 'out' ? String(o.fuel ?? 8) : ''}><option value="">—</option>{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((x) => <option key={x} value={x}>{x}/8</option>)}</select></label>
            <label className="f wide">Оштетувања / забелешки<input name="dmg" defaultValue={o.dmg ?? ''} placeholder="на пр. гребнатинка заден браник десно" /></label>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}><PhotoField name="ph1" label="📷 Слики" /><PhotoField name="ph2" label="📷 +" /><PhotoField name="ph3" label="📷 +" /></div>
          <SignaturePad name="sig" label="Потпис на корисникот:" />
          <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">{kind === 'out' ? '🔑 Предај возило' : '↩ Прими возило'}</button></div>
        </BankForm>);
    };
    return (
      <>
        <Hd t={E.id ? `Изнајмување ${E.number}` : 'Нова резервација'} sub={s[0]}>
          <Link className="btn" href="/rent">← Резервации</Link>
          {E.id && <><Link className="btn" style={{ fontWeight: 700 }} href={`/rent/dogovor?id=${E.id}`} target="_blank">🖨 Договор</Link><Link className="btn" href={`/rent/dogovor?id=${E.id}&n=2`} target="_blank" title="Примерок за корисникот и за изнајмувачот">🖨 2 примероци</Link></>}
        </Hd>
        {W.length > 0 && <div className="callout warn">{W.map((w, i) => <div key={i}>{w}</div>)}</div>}
        {rd && <div className="callout">{rd.read.length ? `✓ Прочитано: ${rd.read.join(', ')}. Проверете ги податоците.` : 'Не се прочитаа податоци – сликајте поблиску и без одблесок.'}</div>}
        <BankForm action={saveRentalAction}>
          <input type="hidden" name="id" value={E.id} /><input type="hidden" name="scans" value={scans.join(',')} />
          {scan && <input type="hidden" name="scanRead" value={scan.id} />}
          <div className="card"><div className="form">
            <label className="f">Возило<select name="veh" defaultValue={E.vehicleId} disabled={E.status !== 'resv'}>{F.map((x) => <option key={x.id} value={x.id}>{x.plate} · {x.name ?? ''}{x.rClass ? ` · ${x.rClass}` : ''}</option>)}</select></label>
            {E.status !== 'resv' && <input type="hidden" name="veh" value={E.vehicleId} />}
            <label className="f">Преземање<input name="from" type="datetime-local" defaultValue={E.from} readOnly={E.status !== 'resv'} /></label>
            <label className="f">Враќање (договорено)<input name="to" type="datetime-local" defaultValue={E.to} /></label>
            <label className="f">Цена по ден (договорена)<input name="pDay" type="number" step="any" defaultValue={E.pDay ? Number(E.pDay) : ''} placeholder={`ценовник: ${fmt(v?.rDay ?? 0)}`} /></label>
            <label className="f">Кауција (ден.)<input name="deposit" type="number" step="any" defaultValue={E.deposit ? Number(E.deposit) : ''} /></label>
            <label className="f">Плаќа фирма<select name="partner" defaultValue={E.partnerId ?? ''}><option value="">— корисникот —</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="f wide">Забелешка<input name="note" defaultValue={E.note ?? ''} /></label>
          </div></div>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Корисник / возач</h2>
            {write && <RentDocScan firmId={firm.id} />}
            {scans.length > 0 && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{scans.map((p) => <a key={p} href={`/api/files/${p}`} target="_blank" rel="noopener noreferrer"><img src={`/api/files/${p}`} alt="" style={{ width: 96, height: 64, objectFit: 'cover', border: '1px solid var(--line)', borderRadius: 4 }} /></a>)}<span className="mini">копии од документите (се чуваат кај договорот)</span></div>}
            <div className="form">
              <label className="f">Име и презиме<input name="d_name" defaultValue={d.name} /></label>
              <label className="f">Државјанство<input name="d_nat" defaultValue={d.nat ?? ''} list="rd_natL" /></label><datalist id="rd_natL">{NAT.map((x) => <option key={x} value={x} />)}</datalist>
              <label className="f">ЕМБГ / Personal No.<input name="d_embg" defaultValue={d.embg ?? ''} /></label>
              <label className="f">Датум на раѓање<input name="d_birth" type="date" defaultValue={d.birth ?? ''} /></label>
              <label className="f wide">Адреса<input name="d_addr" defaultValue={d.addr ?? ''} /></label>
              <label className="f">Вид документ<select name="d_docType" defaultValue={d.docType === 'id' ? 'id' : 'passport'}><option value="passport">Пасош</option><option value="id">Лична карта</option></select></label>
              <label className="f">Лична карта / пасош бр.<input name="d_doc" defaultValue={d.doc ?? ''} /></label>
              <label className="f">Документ важи до<input name="d_docExp" type="date" defaultValue={d.docExp ?? ''} /></label>
              <label className="f">Издаден од<input name="d_docIss" defaultValue={d.docIss ?? ''} /></label>
              <label className="f">Возачка дозвола бр.<input name="d_lic" defaultValue={d.lic ?? ''} /></label>
              <label className="f">Категории<input name="d_licCat" defaultValue={d.licCat ?? ''} placeholder="B" /></label>
              <label className="f">Возачка издадена<input name="d_licFrom" type="date" defaultValue={d.licFrom ?? ''} /></label>
              <label className="f">Возачка важи до<input name="d_licExp" type="date" defaultValue={d.licExp ?? ''} /></label>
              <label className="f">📞 Телефон за контакт *<input name="d_phone" defaultValue={d.phone ?? ''} placeholder="+389 7x xxx xxx" style={{ fontWeight: 700 }} />
                {d.phone && <span className="mini"><a href={`tel:${d.phone}`}>повикај</a> · <a href={`https://wa.me/${String(d.phone).replace(/[^\d]/g, '').replace(/^0/, '389')}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></span>}</label>
              <label className="f">Е-пошта<input name="d_email" defaultValue={d.email ?? ''} /></label>
              <label className="f wide">Контакт во итен случај (име, телефон)<input name="d_emerg" defaultValue={d.emerg ?? ''} placeholder="на пр. сопруга – +389 70 …" /></label>
              <label className="f wide">Дополнителен возач (име, возачка)<input name="driver2" defaultValue={E.driver2 ?? ''} /></label>
            </div></div>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>🌍 Држави во кои ќе се патува</h2>
            <div className="row" style={{ gap: '6px 14px', flexWrap: 'wrap' }}>{RENT_COUNTRIES.map(([c, n]) => (
              <label key={c} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 13.5, whiteSpace: 'nowrap', width: 'auto', margin: 0 }}>
                <input style={{ width: 'auto', margin: 0 }} type="checkbox" name="ct" value={c} defaultChecked={ct.includes(c)} disabled={c === 'MK'} /> {n}</label>))}</div>
            <input type="hidden" name="ct" value="MK" />
            {rentAbroad(ct) && <div className={`callout ${E.green ? 'good' : 'warn'}`} style={{ marginTop: 8 }}>Патување во странство: {ct.filter((x) => x !== 'MK').map(rentCountryName).join(', ')}.
              <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', marginLeft: 8, width: 'auto', whiteSpace: 'nowrap' }}><input style={{ width: 'auto', margin: 0 }} type="checkbox" name="green" defaultChecked={E.green} /> Зелен картон предаден</label>
              <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', marginLeft: 8, width: 'auto', whiteSpace: 'nowrap' }}><input style={{ width: 'auto', margin: 0 }} type="checkbox" name="auth" defaultChecked={d.auth !== false} /> Овластување за излез од државата во договорот</label></div>}
            {!rentAbroad(ct) && <><input type="hidden" name="green" value={E.green ? 'on' : ''} /><input type="hidden" name="auth" value={d.auth === false ? '' : 'on'} /></>}
          </div>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Дополнително</h2>
            <table className="dense"><thead><tr><th>Опис</th><th className="n">Кол.</th><th className="n">Цена со ДДВ</th></tr></thead><tbody>{[...E.extras, ...Array(2).fill({ name: '', qty: 1, price: '' })].map((x, i) => (
              <tr key={i}><td><input name={`x.name.${i}`} defaultValue={x.name} list="rx_l" placeholder="Детско седиште, штета, казна…" style={{ width: 260 }} /></td><td><input name={`x.qty.${i}`} type="number" defaultValue={x.qty} style={{ width: 70 }} /></td><td><input name={`x.price.${i}`} type="number" step="any" defaultValue={x.price} style={{ width: 100 }} /></td></tr>
            ))}</tbody></table>
            <datalist id="rx_l">{RENT_EXTRAS.map((x) => <option key={x} value={x} />)}</datalist>
          </div>
          {!ro && <div className="row" style={{ marginBottom: 8, gap: 8 }}><span style={{ flex: 1 }} />
            {E.id && E.status === 'resv' && <RowAction className="btn ghost" style={{ color: 'var(--bad)' }} action={rentalStepAction.bind(null, E.id, 'cancel')} confirm={`Да се откаже резервацијата ${E.number}?`} label="Откажи" />}
            <Link className="btn" href="/rent">Затвори</Link><button className="btn pri">Зачувај</button>
            {!E.id && <button className="btn" name="andPdf" value="1">💾 Зачувај и 🖨 договор</button>}</div>}
        </BankForm>
        {E.id && <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>{hand('out')}{E.status !== 'resv' && hand('ret')}</div>}
        {k && (
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Пресметка</h2>
            <table className="dense" style={{ maxWidth: 620 }}><tbody>
              <tr><td>{rentCalcLabel(k.days, vehicleRates(v!), C, k.pDayAgreed ?? null)}</td><td className="n">{fmt(k.rent)}</td></tr>
              {k.ex.map((x, i) => <tr key={i}><td>{x.name} {x.qty !== 1 ? `× ${x.qty}` : ''}{'auto' in x && x.auto ? <span className="mini"> (автоматски)</span> : null}</td><td className="n">{fmt(x.qty * x.price)}</td></tr>)}
              <tr><td><b>Вкупно со ДДВ</b></td><td className="n"><b>{fmt(k.tot)}</b></td></tr>
              <tr><td>Кауција {E.depositVoucherId && <span className="pill good">примена</span>}{E.depositClosed && <span className="pill"> задржана {fmt(E.depositKept)}</span>}</td><td className="n">{fmt(k.dep)}</td></tr>
              {k.km > 0 && <tr><td className="mini">Изминати {k.km} км{k.allow ? ` (вклучени ${k.allow})` : ' (неограничено)'}</td><td /></tr>}
            </tbody></table>
          </div>
        )}
        {E.id && write && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }} />
            {Number(E.deposit) > 0 && !E.depositVoucherId && E.status !== 'cancel' && <RowAction className="btn" action={rentalStepAction.bind(null, E.id, 'dep')} confirm={`Уплатница за кауција ${fmt(E.deposit)} ден. (Должи благајна / Побарува ${C.depK})?`} label="💰 Прими кауција" />}
            {E.status === 'ret' && !E.invoiceId && <RowAction className="btn pri" action={rentalStepAction.bind(null, E.id, 'inv')} label="🧾 Фактура" />}
            {inv && (inv.st === 'draft' ? <Link className="btn" href={`/izlez?edit=${E.invoiceId}`}>🧾 Нацрт-фактура {inv.n} – провери и зачувај</Link> : <span className="pill good">Фактура {inv.n}</span>)}
          </div>
        )}
        {E.id && write && E.depositVoucherId && !E.depositClosed && E.status !== 'resv' && (
          <BankForm action={settleDepositAction} className="card row" style={{ gap: 8, alignItems: 'end' }} confirm="Да се порамни кауцијата (пребивање со фактурата и исплатница за остатокот)?">
            <input type="hidden" name="id" value={E.id} />
            <label className="f">Кауција {fmt(E.deposit)} ден.{inv ? ` · фактура ${inv.n}` : ''} – колку да се задржи (пребие со фактурата)<input name="keep" type="number" step="any" defaultValue={inv ? Math.min(Number(E.deposit), Number(inv.t)) : 0} /></label>
            <button className="btn">↩ Порамни кауција</button>
          </BankForm>
        )}
        {E.id && E.status === 'resv' && Number(E.deposit) > 0 && !E.depositVoucherId && <p className="note">Не заборавајте „💰 Прими кауција“ при предавањето.</p>}
      </>
    );
  }

  const F0 = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(T, -2);
  const days = [...Array(21)].map((_, i) => addDays(F0, i));
  const A = await db().select().from(rentRentals).where(and(eq(rentRentals.firmId, firm.id), ne(rentRentals.status, 'cancel'))).orderBy(asc(rentRentals.from));
  const occ = (vid: string, d: string) => A.find((r) => r.vehicleId === vid && r.from.slice(0, 10) <= d && d <= String(r.ret.at || r.to).slice(0, 10));
  const now = nowLocal();
  const dueT = A.filter((r) => r.status === 'out' && r.to.slice(0, 10) <= T);
  const free = F.filter((x) => !occ(x.id, T)).length;
  const list = A.filter((r) => ['resv', 'out', 'ret'].includes(st(r)));
  return (
    <>
      <Hd t="Rent-a-car – резервации" sub={dmy(T)}>
        <Link className="btn" href="/flota">🚙 Флота и цени</Link>
        <Link className="btn" href="/rentIzv">📈 Извештаи</Link>
        {write && <Link className="btn pri" href="/rent?nov=1">+ Нова резервација</Link>}
      </Hd>
      {!F.length && <div className="callout warn">Нема возила за изнајмување: во „🚙 Флота и цени“ означете ги возилата и внесете цени.</div>}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {([['Слободни денес', `${free} / ${F.length}`], ['Кај клиенти', A.filter((r) => r.status === 'out').length], ['Преземања денес', A.filter((r) => r.status === 'resv' && r.from.slice(0, 10) === T).length], ['Враќања денес / доцнат', dueT.length]] as const).map(([t, v]) => (
          <div key={t} className="card" style={{ flex: 1, minWidth: 160, margin: 0 }}><div className="mini">{t}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{v}</div></div>
        ))}
      </div>
      {dueT.some((r) => r.to < now) && <div className="callout warn">⏰ Требаше да се вратат: {dueT.filter((r) => r.to < now).map((r) => `${r.plate} – ${r.driver.name} (${dt(r.to)})`).join(', ')}</div>}
      <div className="card" style={{ padding: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <Link className="btn sm" href={`/rent?from=${addDays(F0, -7)}`}>◀</Link><DateJump base="/rent" value={F0} /><Link className="btn sm" href={`/rent?from=${addDays(F0, 7)}`}>▶</Link><Link className="btn sm ghost" href="/rent">Денес</Link>
          <span className="mini">Клик на празно поле = нова резервација</span>
        </div>
        <div className="tw"><table className="dense" style={{ tableLayout: 'fixed', minWidth: 1000 }}>
          <thead><tr><th style={{ width: 130 }}>Возило</th>{days.map((d) => <th key={d} style={{ textAlign: 'center', background: d === T ? 'var(--accent-soft)' : undefined }}>{d.slice(8)}.{d.slice(5, 7)}</th>)}</tr></thead>
          <tbody>{F.map((x) => (
            <tr key={x.id}><td><b>{x.plate}</b><div className="mini">{x.name}</div></td>
              {days.map((d) => {
                const r = occ(x.id, d);
                if (!r) return <td key={d} style={{ background: d === T ? 'var(--accent-soft)' : undefined }}>{write && <Link href={`/rent?nov=1&veh=${x.id}&d=${d}`} style={{ display: 'block', height: 18 }} aria-label="нова резервација" />}</td>;
                const first = r.from.slice(0, 10) === d || d === days[0];
                return <td key={d} title={`${r.driver.name} · ${dt(r.from)} – ${dt(r.to)} · ${RENT_STATUS[st(r)][0]}`} style={{ background: RENT_STATUS[st(r)][2], fontSize: 11, overflow: 'hidden', whiteSpace: 'nowrap', borderLeft: first ? '3px solid #555' : undefined }}>
                  <Link href={`/rent?id=${r.id}`} style={{ color: 'inherit', display: 'block' }}>{first ? r.driver.name || '?' : ' '}</Link></td>;
              })}</tr>
          ))}</tbody></table></div>
      </div>
      <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Активни и идни</h2>
        <div className="tw"><table className="dense"><thead><tr><th>Број</th><th>Возило</th><th>Корисник</th><th>Од</th><th>До</th><th className="n">Денови</th><th className="n">Износ</th><th className="n">Кауција</th><th>Статус</th><th /></tr></thead>
          <tbody>{list.map((r) => { const v = F.find((x) => x.id === r.vehicleId); const k = v ? rcCalc(r, vehicleRates(v), C) : null; const s = RENT_STATUS[st(r)]; return (
            <tr key={r.id}><td>{r.number}</td><td>{r.plate}</td><td>{r.driver.name}</td><td>{dt(r.from)}</td><td>{dt(r.to)}</td><td className="n">{k?.days}</td><td className="n">{k ? fmt(k.tot) : ''}</td>
              <td className="n">{Number(r.deposit) ? fmt(r.deposit) + (r.depositVoucherId ? ' ✓' : '') : ''}</td><td><span className={`pill ${s[1]}`}>{s[0]}</span></td><td><Link className="btn sm" href={`/rent?id=${r.id}`}>Отвори</Link></td></tr>); })}
            {!list.length && <tr><td colSpan={10} className="note">Нема.</td></tr>}</tbody></table></div>
      </div>
    </>
  );
}
