'use client';
/**
 * Freight (превоз за трети лица) client parts — legacy `frEditor` 14503 + patch 14703 (quick add), the tour pick bar of
 * `VIEWS.frTuri` (14494 „Штиклирајте тури…“ / „🧾 Фактурирај избрани (n)“), `monSel` month selects that reload on
 * change (frDnev / frGor), and the document form of `VIEWS.frDok` (За switch reloads kinds and refs, patch 14667 hints).
 */
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  FR_COUNTRIES, FR_CURRENCIES, FR_DOC_DRIVER, FR_DOC_VEHICLE, FR_REDUCTIONS, FR_STATUS, FR_TOLL_CURRENCIES, frCost, frPerDiems, currencyText,
} from '@wise/core/industry';
import { fmt } from '@/lib/fmt';
import { saveFreightAction } from '@/app/(app)/pnalozi/actions';
import { frDeleteTourAction, frDocSaveAction, frInvoiceAction, frQuickAction, type QuickState } from '@/app/(app)/frTuri/actions';
import type { FormState } from './bank-form';
import { RowAction } from './row-action';

const r2 = (v: number) => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ month select (monSel) */

export function MonthSelect({ value, options, param = 'mo', label = 'Месец', blank }: { value: string; options: { value: string; label: string }[]; param?: string; label?: string; blank?: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <label className="f" style={{ width: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 }}>{label}
      <select style={{ width: 'auto' }} value={value} onChange={(e) => {
        const q = new URLSearchParams(sp.toString());
        if (e.target.value) q.set(param, e.target.value); else q.delete(param);
        router.push(`${path}?${q.toString()}`);
      }}>{blank != null && <option value="">{blank}</option>}{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </label>
  );
}

/* ------------------------------------------------------------------ tours list: pick → invoice */

export function FreightPickForm({ filters, children, write }: { filters: React.ReactNode; children: React.ReactNode; write: boolean }) {
  const [st, run, pending] = useActionState<FormState, FormData>(frInvoiceAction, {});
  const [n, setN] = useState(0);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {filters}
        {write && n > 0 ? <button className="btn pri" form="frInvForm" disabled={pending}>🧾 Фактурирај избрани ({n})</button> : <span className="note">Штиклирајте тури на ист клиент → една фактура.</span>}
      </div>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <form id="frInvForm" ref={ref} action={run} onChange={() => setN(ref.current ? ref.current.querySelectorAll('input[name=sel]:checked').length : 0)}>{children}</form>
    </>
  );
}

/* ------------------------------------------------------------------ tour editor */

export interface FrSeg { c: string; in: string; out: string; units: string }
export interface FrEditorTour {
  id: string; number: string; date: string; status: string; partnerId: string; orderNo: string; km: string; vehicleId: string; trailer: string; driverId: string; driver2Id: string;
  loadPlace: string; loadC: string; sender: string; unloadDate: string; unloadPlace: string; unloadC: string; consignee: string; retDate: string;
  goods: string; packages: string; kg: string; m3: string; adr: string; docsAtt: string; price: string; cur: string; fx: string; vat: string; red: string;
  tolls: string; tollCur: string; otherCost: string; note: string; segs: FrSeg[]; invoiceId: string | null; invNumber: string | null;
}

const ctryOpts = (withMk: boolean) => (
  <><option value="">— држава —</option>{withMk && <option value="MK">Македонија</option>}{FR_COUNTRIES.map((c) => <option key={c[0]} value={c[0]}>{c[1]}</option>)}</>
);
const H2 = ({ children }: { children: React.ReactNode }) => <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{children}</h2>;

export function FreightEditor({ t, partners, vehicles, trailers, drivers, rates, fxTable, fuel, bad, write, canDel, focusSeg }: {
  t: FrEditorTour; partners: { id: string; name: string }[]; vehicles: { id: string; label: string }[]; trailers: { plate: string; name: string }[];
  drivers: { id: string; name: string }[]; rates: Record<string, [number, string]>; fxTable: Record<string, number>; fuel: { mkd: number; l: number };
  bad: string[]; write: boolean; canDel: boolean; focusSeg: boolean;
}) {
  const [st, run, pending] = useActionState<FormState, FormData>(saveFreightAction, {});
  const [V, setV] = useState(vehicles), [TR, setTR] = useState(trailers), [D, setD] = useState(drivers);
  const [veh, setVeh] = useState(t.vehicleId), [trl, setTrl] = useState(t.trailer), [drv, setDrv] = useState(t.driverId), [drv2, setDrv2] = useState(t.driver2Id);
  const [date, setDate] = useState(t.date), [unloadDate, setUnloadDate] = useState(t.unloadDate);
  const [price, setPrice] = useState(t.price), [cur, setCur] = useState(t.cur || 'EUR'), [fxIn, setFxIn] = useState(t.fx);
  const [red, setRed] = useState(t.red || '100'), [segs, setSegs] = useState<FrSeg[]>(t.segs);
  const [tolls, setTolls] = useState(t.tolls), [tollCur, setTollCur] = useState(t.tollCur || 'EUR'), [oth, setOth] = useState(t.otherCost);
  const [quick, setQuick] = useState<null | 'veh' | 'trl' | 'drv'>(null);
  const segRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    if (!focusSeg) return;
    const id = setTimeout(() => { const tr = segRef.current?.querySelector('tr'); if (tr) { tr.scrollIntoView({ block: 'center' }); tr.querySelector('select')?.focus(); } }, 60);
    return () => clearTimeout(id);
  }, [focusSeg]);

  const fx = (c: string, d: string) => (c === 'MKD' ? 1 : fxTable[`${c}|${String(d).slice(0, 10)}`] ?? fxTable[`${c}|*`] ?? 0);
  const rate = cur !== 'MKD' ? Number(fxIn) || fx(cur, unloadDate || date) : 1;
  const rev = r2((Number(price) || 0) * rate);
  const dn = useMemo(() => frPerDiems({ red: Number(red) || 100, segs: segs.map((g) => ({ ...g, units: g.units === '' ? null : g.units })), date }, fx, rates), [segs, red, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = frCost({ tolls, tollCur, otherCost: oth, date }, fuel.mkd, dn.mkd, fx);
  const diff = r2(rev - c.total);
  const invoiced = !!t.invoiceId;
  const setSeg = (i: number, k: keyof FrSeg, v: string) => setSegs((S) => S.map((g, j) => (j === i ? { ...g, [k]: v } : g)));
  let ri = 0;

  return (
    <>
      <div className="hd">
        <h1>{t.id ? `Тура ${t.number}` : 'Нова тура'}{t.invNumber && <span className="mk">фактурирана со {t.invNumber}</span>}</h1>
        <div className="row">
          <Link className="btn" href="/frTuri">Откажи</Link>
          {t.id && <><Link className="btn" href={`/frTuri/cmr?id=${t.id}`} target="_blank">📄 CMR</Link><Link className="btn" href={`/frDnev/print?id=${t.id}`} target="_blank">🌍 Дневници PDF</Link></>}
          {t.id && canDel && !invoiced && <RowAction className="btn danger" action={frDeleteTourAction.bind(null, t.id)} confirm={`Да се избрише турата ${t.number}?`} label="🗑 Избриши" />}
          {write && <button className="btn pri" form="frForm" disabled={pending}>Зачувај</button>}
        </div>
      </div>
      {bad.length > 0 && <div className="callout bad">⛔ Истечени документи: {bad.join(', ')}</div>}
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <form id="frForm" action={run}>
        <input type="hidden" name="id" value={t.id} />
        <div className="card"><H2>Основно</H2><div className="form">
          <label className="f">Број на тура<input name="number" defaultValue={t.number} /></label>
          <label className="f">Датум (товарење)<input name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="f">Статус<select name="status" defaultValue={t.status}>{Object.entries(FR_STATUS).filter(([k]) => k !== 'inv' || t.status === 'inv').map(([k, s]) => <option key={k} value={k}>{s[0]}</option>)}</select></label>
          <label className="f wide">Клиент (налогодавач)<select name="partner" defaultValue={t.partnerId}><option value="">— избери —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="f">Број на нарачка кај клиентот<input name="orderNo" defaultValue={t.orderNo} /></label>
          <label className="f">Километри<input name="km" type="number" step="any" defaultValue={t.km} /></label>
          <label className="f">Влекач / камион<select name="veh" value={veh} onChange={(e) => setVeh(e.target.value)}><option value="">— возило —</option>{V.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
            {write && <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setQuick('veh')}>+ ново возило</button>}</label>
          <label className="f">Приколка (регистрација)<input name="trailer" value={trl} onChange={(e) => setTrl(e.target.value)} list="frTrlList" />
            <datalist id="frTrlList">{TR.map((a) => <option key={a.plate} value={a.plate}>{a.name}</option>)}</datalist>
            {write && <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setQuick('trl')}>+ приколка</button>}</label>
          <label className="f">Возач<select name="drv" value={drv} onChange={(e) => setDrv(e.target.value)}><option value="">— возач —</option>{D.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            {write && <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setQuick('drv')}>+ нов возач</button>}</label>
          <label className="f">Втор возач<select name="drv2" value={drv2} onChange={(e) => setDrv2(e.target.value)}><option value="">— нема —</option>{D.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        </div></div>

        <div className="cols3" style={{ marginBottom: 12 }}>
          <div className="card"><H2>📦 Товарење</H2>
            <label className="f">Место на товарење<input name="loadPlace" defaultValue={t.loadPlace} /></label>
            <label className="f">Држава<select name="loadC" defaultValue={t.loadC}>{ctryOpts(true)}</select></label>
            <label className="f">Испраќач (име и адреса) – поле 1 во CMR<input name="sender" defaultValue={t.sender} /></label>
          </div>
          <div className="card"><H2>🏁 Истовар</H2>
            <label className="f">Датум на истовар<input name="unloadDate" type="date" value={unloadDate} onChange={(e) => setUnloadDate(e.target.value)} /></label>
            <label className="f">Место на истовар<input name="unloadPlace" defaultValue={t.unloadPlace} /></label>
            <label className="f">Држава<select name="unloadC" defaultValue={t.unloadC}>{ctryOpts(true)}</select></label>
            <label className="f">Примач (име и адреса) – поле 2 во CMR<input name="consignee" defaultValue={t.consignee} /></label>
            <label className="f">Враќање во база<input name="retDate" type="date" defaultValue={t.retDate} title="Крај на периодот за горивото од картичките" /></label>
          </div>
        </div>

        <div className="card"><H2>Стока (за CMR)</H2><div className="form">
          <label className="f">Вид на стока<input name="goods" defaultValue={t.goods} /></label>
          <label className="f">Број на колети / палети<input name="packages" defaultValue={t.packages} /></label>
          <label className="f">Бруто тежина (кг)<input name="kg" type="number" step="any" defaultValue={t.kg} /></label>
          <label className="f">Волумен (m³)<input name="m3" type="number" step="any" defaultValue={t.m3} /></label>
          <label className="f">ADR класа (ако има)<input name="adr" defaultValue={t.adr} /></label>
          <label className="f">Приложени документи (фактура, ЕЦД…)<input name="docsAtt" defaultValue={t.docsAtt} /></label>
        </div></div>

        <div className="card"><H2>💶 Цена и фактура</H2><div className="form">
          <label className="f">Договорена цена (без ДДВ)<input name="price" type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label className="f">Валута<select name="cur" value={cur} onChange={(e) => setCur(e.target.value)}>{FR_CURRENCIES.map((x) => <option key={x}>{x}</option>)}</select></label>
          {cur !== 'MKD' && <label className="f">Курс (празно = НБРМ на датумот на истовар)<input name="fx" type="number" step="any" value={fxIn} onChange={(e) => setFxIn(e.target.value)} /></label>}
          <label className="f">ДДВ<select name="vat" defaultValue={t.vat}><option value="intl">Меѓународен превоз – ослободено (0%)</option><option value="dom">Домашен превоз – 18%</option></select></label>
        </div>
          <p className="note">Во денари: <b>{fmt(rev)}</b>{cur !== 'MKD' ? ` (курс ${rate})` : ''}. Проверете го ослободувањето од ДДВ за конкретниот превоз според ЗДДВ.</p>
        </div>

        <div className="card"><H2>🌍 Граници и дневници во странство</H2>
          <p className="note">За секоја држава: влез и излез (датум и час), по редослед од излезот од Македонија до враќањето. Вкупното време: секои 24 ч = 1 дневница, остаток над 12 ч = 1, 8–12 ч = ½; дневниците се делат по држави според времето. Во „Дневници“ можете рачно да внесете друг број.</p>
          <div className="tw"><table className="dense"><thead><tr><th>Држава</th><th>Влез</th><th>Излез</th><th className="n">Часови</th><th className="n">Дневници</th><th className="n">Износ</th><th /></tr></thead>
            <tbody ref={segRef}>{segs.map((g, i) => {
              const r = g.c ? dn.rows[ri++] : undefined;
              return (
                <tr key={i}>
                  <td><select name={`g.c.${i}`} value={g.c} onChange={(e) => setSeg(i, 'c', e.target.value)}>{ctryOpts(false)}</select></td>
                  <td><input name={`g.in.${i}`} type="datetime-local" value={g.in} onChange={(e) => setSeg(i, 'in', e.target.value)} /></td>
                  <td><input name={`g.out.${i}`} type="datetime-local" value={g.out} onChange={(e) => setSeg(i, 'out', e.target.value)} /></td>
                  <td className="n">{r?.hrs != null ? r2(r.hrs) : ''}</td>
                  <td className="n"><input name={`g.units.${i}`} type="number" step="0.5" value={g.units} placeholder={r?.auto != null ? String(r.auto) : ''} onChange={(e) => setSeg(i, 'units', e.target.value)} style={{ width: 70, textAlign: 'right' }} /></td>
                  <td className="n">{r ? `${fmt(r.v)} ${r.cur}` : ''}</td>
                  <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани" onClick={() => setSegs((S) => S.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              );
            })}</tbody></table></div>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button type="button" className="btn sm" onClick={() => setSegs((S) => [...S, { c: '', in: S[S.length - 1]?.out || '', out: '', units: '' }])}>+ Држава</button>
            <label className="f" style={{ margin: 0 }}>Намалување<select name="red" value={red} onChange={(e) => setRed(e.target.value)}>{FR_REDUCTIONS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
          </div>
          <p className="note">Вкупно време во странство: <b>{dn.totH} ч</b> → <b>{dn.totU}</b> дневници (поделени по држави според времето). Износ: <b>{currencyText(dn.by, fmt)}</b> = {fmt(dn.mkd)} ден.{dn.miss.length > 0 && <span style={{ color: 'var(--bad)' }}> Нема курс за {dn.miss.join(', ')} – внесете го во Курсна листа.</span>}</p>
        </div>

        <div className="card"><H2>Трошоци на турата</H2><div className="form">
          <label className="f">Патарини<input name="tolls" type="number" step="any" value={tolls} onChange={(e) => setTolls(e.target.value)} /></label>
          <label className="f">Валута на патарини<select name="tollCur" value={tollCur} onChange={(e) => setTollCur(e.target.value)}>{FR_TOLL_CURRENCIES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="f">Други трошоци (ден.)<input name="otherCost" type="number" step="any" value={oth} onChange={(e) => setOth(e.target.value)} /></label>
        </div>
          <p className="note">Гориво од картички: <b>{fmt(c.fuel)}</b> ден. ({fuel.l} л) · патарини {fmt(c.tolls)} · дневници {fmt(c.dn)} · други {fmt(c.oth)} → <b>вкупно {fmt(c.total)}</b> · разлика <b style={diff < 0 ? { color: 'var(--bad)' } : undefined}>{fmt(diff)}</b> ден.</p>
          <label className="f">Забелешка<input name="note" defaultValue={t.note} /></label>
        </div>
        {invoiced && <p className="note">Турата е фактурирана ({t.invNumber}) – цената, валутата, ДДВ и клиентот не се менуваат тука. Користете одобрение или нова фактура.</p>}
      </form>
      {quick && <QuickModal k={quick} onClose={() => setQuick(null)} onDone={(r) => {
        if (r.k === 'drv') { setD((L) => [...L, { id: r.id!, name: r.label! }]); if (!drv) setDrv(r.id!); else if (!drv2) setDrv2(r.id!); }
        else if (r.k === 'trl') { setTR((L) => [...L, { plate: r.plate!, name: r.label! }]); setTrl(r.plate!); }
        else { setV((L) => [...L, { id: r.id!, label: r.label! }]); setVeh(r.id!); }
        setQuick(null);
      }} />}
    </>
  );
}

function QuickModal({ k, onClose, onDone }: { k: 'veh' | 'trl' | 'drv'; onClose: () => void; onDone: (r: QuickState) => void }) {
  const [st, run, pending] = useActionState<QuickState, FormData>(frQuickAction, {});
  const done = useRef(false);
  useEffect(() => { if (st.id && !done.current) { done.current = true; onDone(st); } }, [st, onDone]);
  const isD = k === 'drv';
  return (
    <div className="modal" role="dialog" aria-modal="true"><div className="card" style={{ maxWidth: 460, width: '100%' }}>
      <div className="hd"><h2>{isD ? 'Нов возач' : k === 'trl' ? 'Нова приколка' : 'Ново возило (влекач / камион)'}</h2><button type="button" className="btn" onClick={onClose}>Откажи</button></div>
      <form action={run}>
        <input type="hidden" name="k" value={k} />
        {st.error && <div className="callout bad" role="alert">{st.error}</div>}
        <div className="form">
          {isD ? <>
            <label className="f wide">Име и презиме<input name="name" autoFocus /></label>
            <label className="f">ЕМБГ<input name="embg" inputMode="numeric" maxLength={13} /></label>
            <label className="f">Возачка дозвола бр.<input name="license" /></label>
          </> : <>
            <label className="f">Регистрација<input name="plate" placeholder="SK-1234-AB" autoFocus /></label>
            <label className="f">Марка / модел<input name="name" placeholder={k === 'trl' ? 'Schmitz Cargobull' : 'Scania R450'} /></label>
          </>}
        </div>
        <p className="note">{isD ? 'Се додава во Вработени (за плата и МПИН дополнете ги останатите податоци таму).' : 'Се додава во Возен парк (Флота). Набавната вредност и амортизацијата дополнете ги подоцна во ОС → Регистар.'}</p>
        <div className="row"><button className="btn pri" disabled={pending}>Зачувај</button></div>
      </form>
    </div></div>
  );
}

/* ------------------------------------------------------------------ licences and documents form */

export function FrDocForm({ doc, vehicles, drivers }: {
  doc: { id: string; who: 'veh' | 'drv'; ref: string; kind: string; no: string; validFrom: string; validTo: string; note: string };
  vehicles: { id: string; label: string }[]; drivers: { id: string; label: string }[];
}) {
  const [st, run, pending] = useActionState<FormState, FormData>(frDocSaveAction, {});
  const [who, setWho] = useState(doc.who);
  const [ref, setRef] = useState(doc.ref || (doc.who === 'drv' ? drivers : vehicles)[0]?.id || '');
  const [kind, setKind] = useState(doc.kind || (doc.who === 'drv' ? FR_DOC_DRIVER : FR_DOC_VEHICLE)[0]);
  const L = who === 'drv' ? drivers : vehicles;
  const K: readonly string[] = who === 'drv' ? FR_DOC_DRIVER : FR_DOC_VEHICLE;
  return (
    <form className="card" action={run}>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <input type="hidden" name="id" value={doc.id} />
      <div className="form">
        <label className="f">За<select name="who" value={who} onChange={(e) => {
          const w = e.target.value === 'drv' ? 'drv' : 'veh';
          setWho(w); setRef((w === 'drv' ? drivers : vehicles)[0]?.id ?? ''); setKind((w === 'drv' ? FR_DOC_DRIVER : FR_DOC_VEHICLE)[0]);
        }}><option value="veh">Возило / приколка</option><option value="drv">Возач</option></select></label>
        <label className="f">Возило / возач<select name="ref" value={ref} onChange={(e) => setRef(e.target.value)}>{L.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
          {!L.length && <small className="note" style={{ color: 'var(--bad)' }}>{who === 'drv'
            ? <>Нема внесени вработени. Возачите се внесуваат во <Link href="/vraboteni">Вработени</Link>.</>
            : <>Нема возила. Камионите и приколките се внесуваат во <Link href="/flota">Возен парк</Link> (со регистрација).</>}</small>}</label>
        <label className="f">Вид<select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>{K.map((k) => <option key={k}>{k}</option>)}{!K.includes(kind) && <option>{kind}</option>}</select></label>
        <label className="f">Број<input name="no" defaultValue={doc.no} /></label>
        <label className="f">Важи од<input name="validFrom" type="date" defaultValue={doc.validFrom} /></label>
        <label className="f">Важи до<input name="validTo" type="date" defaultValue={doc.validTo} /></label>
      </div>
      <label className="f">Забелешка<input name="note" defaultValue={doc.note} /></label>
      <div className="row" style={{ gap: 8, marginTop: 6 }}><Link className="btn" href="/frDok">Откажи</Link><button className="btn pri" disabled={pending}>Зачувај</button></div>
    </form>
  );
}
