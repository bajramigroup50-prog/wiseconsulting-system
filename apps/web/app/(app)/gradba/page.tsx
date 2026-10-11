/**
 * Legacy `VIEWS.gradba` 10055 → 11839 — Градежништво: projects (BOQ / contract), situations (cumulative quantities,
 * invoice through Phase 3, art. 32-a), costs and result, construction diary. The open project is a URL parameter —
 * FIX LEGACY-MAP 10.4 item 2 (legacy shared `S.cpEd` with the coupon editor).
 */
import Link from 'next/link';
import { and, asc, desc, eq } from 'drizzle-orm';
import { boqValue, situationCalc, sortSituations } from '@wise/core/industry';
import {
  constructionDiary, constructionProjects, employees, firmConsConfig, invoices, partners, projectCosts, projectSituations, unlinkedCosts,
} from '@wise/db';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { addProjectPhotosAction, importBoqAction, importProjectsAction, invoiceSituationAction, linkCostsAction, saveConsConfigAction, saveDiaryAction, saveProjectAction, saveSituationAction } from './actions';
import { CONS_BOQ_IMPORT, CONS_PROJECT_IMPORT, oxTemplate } from '@wise/core/industry';
import { entityFiles } from '@wise/db';
import { XlsxImport } from '@/components/list-tools';
import { UploadField } from '@/components/upload-field';

type SP = { p?: string; t?: string; s?: string; d?: string };
const TABS = [['boq', '📐 Предмер и договор'], ['sit', '🧾 Ситуации'], ['cost', '💰 Трошоци и резултат'], ['dn', '📓 Градежен дневник']] as const;

export default async function GradbaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const g = await industryPage('gradba', 'Градежништво – објекти');
  if (g.blocked) return g.blocked;
  const { firm, write } = g;
  const C = firmConsConfig(firm);
  const all = await db().select().from(constructionProjects).where(eq(constructionProjects.firmId, firm.id)).orderBy(desc(constructionProjects.start));

  if (sp.p) {
    const P = all.find((x) => x.id === sp.p);
    const T = P ? (TABS.some((x) => x[0] === sp.t) ? sp.t! : 'boq') : 'boq';
    const href = (o: Record<string, string>) => '/gradba?' + new URLSearchParams({ p: P?.id ?? 'new', ...o }).toString();
    let body: React.ReactNode;
    if (T === 'boq') {
      const E = P ?? { id: '', code: '', name: '', site: '', city: '', investorId: '', cno: '', cdate: '', start: today(), end: '', nadzor: '', eng: '', art32: false, boq: [] };
      const PP = await partnerOptions(firm.id);
      body = (
        <BankForm action={saveProjectAction}>
          <input type="hidden" name="id" value={E.id} />
          <div className="card"><div className="form">
            <label className="f">Шифра<input name="code" defaultValue={E.code} placeholder="автоматски" /></label>
            <label className="f wide">Објект / проект<input name="name" defaultValue={E.name} /></label>
            <label className="f wide">Локација (адреса, КП)<input name="site" defaultValue={E.site ?? ''} /></label>
            <label className="f">Град / општина<input name="city" defaultValue={E.city ?? ''} /></label>
            <label className="f">Инвеститор<select name="inv" defaultValue={E.investorId}><option value="">—</option>{PP.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="f">Договор бр.<input name="cno" defaultValue={E.cno ?? ''} /></label>
            <label className="f">Датум на договор<input name="cdate" type="date" defaultValue={E.cdate ?? ''} /></label>
            <label className="f">Почеток<input name="start" type="date" defaultValue={E.start ?? ''} /></label>
            <label className="f">Рок за завршување<input name="end" type="date" defaultValue={E.end ?? ''} /></label>
            <label className="f">Надзор<input name="nadzor" defaultValue={E.nadzor ?? ''} /></label>
            <label className="f">Одговорен инженер<input name="eng" defaultValue={E.eng ?? ''} /></label>
          </div>
            <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" name="art32" defaultChecked={E.art32} /> Пренесување на даночна обврска (чл. 32-а од Законот за ДДВ) – инвеститорот е ДДВ обврзник и прима градежни услуги</label>
          </div>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Предмер-пресметка: {fmt(boqValue(E.boq))} ден. без ДДВ</h2>
            <div className="tw"><table className="dense"><thead><tr><th>Поз.</th><th>Опис на работата</th><th>ЕМ</th><th className="n">Количина</th><th className="n">Ед. цена</th><th className="n">Износ</th></tr></thead>
              <tbody>{[...E.boq, ...Array(4).fill({ pos: '', desc: '', unit: 'м²', qty: '', price: '' })].map((l, i) => (
                <tr key={i}><td><input name={`q.pos.${i}`} defaultValue={l.pos ?? (i < E.boq.length ? '' : String(i + 1))} style={{ width: 60 }} /></td><td><input name={`q.desc.${i}`} defaultValue={l.desc} style={{ minWidth: 300 }} /></td>
                  <td><input name={`q.unit.${i}`} defaultValue={l.unit ?? ''} style={{ width: 60 }} /></td><td className="n"><input name={`q.qty.${i}`} type="number" step="any" defaultValue={l.qty} style={{ width: 90 }} /></td>
                  <td className="n"><input name={`q.price.${i}`} type="number" step="any" defaultValue={l.price} style={{ width: 100 }} /></td><td className="n">{l.desc ? fmt(Number(l.qty) * Number(l.price)) : ''}</td></tr>
              ))}</tbody></table></div>
            <label className="f wide" style={{ marginTop: 6 }}>📋 Залепи од Excel (позиција, опис, ЕМ, количина, цена – одделени со TAB)<textarea name="paste" rows={3} /></label>
          </div>
          {write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>}
        </BankForm>
      );
    } else if (T === 'sit') {
      const S = sortSituations(await projectSituations(db(), P!.id));
      const E = sp.s === 'new' ? (() => { const last = S[S.length - 1]; return { id: '', no: String(S.length + 1), kind: 'int' as const, date: today(), from: last ? last.to ?? last.date : P!.start, to: today(), cum: { ...(last?.cum ?? {}) }, invoiceId: null }; })() : S.find((x) => x.id === sp.s);
      const inv = new Map((await db().select({ id: invoices.id, n: invoices.number }).from(invoices).where(eq(invoices.firmId, firm.id))).map((x) => [x.id, x.n]));
      if (E) {
        const c = situationCalc(P!.boq, S, E);
        body = (
          <BankForm action={saveSituationAction}>
            <input type="hidden" name="id" value={E.id} /><input type="hidden" name="proj" value={P!.id} />
            <div className="card"><div className="form">
              <label className="f">Ситуација бр.<input name="no" defaultValue={E.no} /></label>
              <label className="f">Вид<select name="kind" defaultValue={E.kind}><option value="int">привремена</option><option value="fin">окончателна</option></select></label>
              <label className="f">Датум<input name="date" type="date" defaultValue={E.date} /></label>
              <label className="f">Период од<input name="from" type="date" defaultValue={E.from ?? ''} /></label>
              <label className="f">до<input name="to" type="date" defaultValue={E.to ?? ''} /></label>
            </div></div>
            <div className="card"><p className="note" style={{ margin: '0 0 6px' }}>Внесете ја <b>вкупно изведената количина досега</b> (кумулативно) или процент; износот за оваа ситуација = досега − претходни ситуации.</p>
              <div className="tw"><table className="dense"><thead><tr><th>Поз.</th><th>Опис</th><th>ЕМ</th><th className="n">Предмер</th><th className="n">Претходно</th><th className="n">Изведено досега</th><th className="n">или %</th><th className="n">Оваа ситуација</th><th className="n">Ед. цена</th><th className="n">Износ</th></tr></thead>
                <tbody>{c.L.map((l) => (
                  <tr key={l.i}><td>{l.pos}</td><td>{l.desc}</td><td>{l.unit}</td><td className="n">{l.qty}</td><td className="n">{l.p}</td>
                    <td className="n"><input type="hidden" name={`bq.${l.i}`} value={String(l.qty)} /><input name={`cum.${l.i}`} type="number" step="any" defaultValue={l.c || ''} style={{ width: 90 }} disabled={!!E.invoiceId} /></td>
                    <td className="n"><input name={`pct.${l.i}`} type="number" step="any" style={{ width: 60 }} disabled={!!E.invoiceId} /></td>
                    <td className="n" style={{ color: l.d < 0 ? 'var(--bad)' : undefined }}>{l.d || ''}</td><td className="n">{fmt(l.price)}</td><td className="n">{l.amt ? fmt(l.amt) : ''}</td></tr>
                ))}</tbody>
                <tfoot><tr><td colSpan={9}>Оваа ситуација (без ДДВ)</td><td className="n"><b>{fmt(c.cur)}</b></td></tr><tr><td colSpan={9}>Кумулативно изведено · {c.pct}% од предмерот</td><td className="n">{fmt(c.cum)}</td></tr></tfoot></table></div>
              {c.L.some((l) => l.over) && <div className="callout warn">Некои позиции се над предмерот (вишок работи) – потребен анекс кон договорот.</div>}
            </div>
            <div className="row" style={{ gap: 8 }}><span style={{ flex: 1 }} /><Link className="btn" href={href({ t: 'sit' })}>Откажи</Link>
              {E.id && <Link className="btn" href={`/gradba/situacija?id=${E.id}`} target="_blank">🖨 PDF</Link>}
              {write && !E.invoiceId && <button className="btn pri">Зачувај</button>}
              {write && E.id && !E.invoiceId && <RowAction className="btn pri" action={invoiceSituationAction.bind(null, E.id)} label="🧾 Фактура" />}
              {E.invoiceId && <span className="pill good">Фактура {inv.get(E.invoiceId)}</span>}</div>
          </BankForm>
        );
      } else body = (
        <>{write && <div className="row" style={{ marginBottom: 8 }}><Link className="btn pri" href={href({ t: 'sit', s: 'new' })}>+ Нова ситуација</Link></div>}
          <div className="tw"><table><thead><tr><th>Бр.</th><th>Вид</th><th>Датум</th><th>Период</th><th className="n">Износ без ДДВ</th><th className="n">Кумулативно</th><th>Фактура</th><th /></tr></thead>
            <tbody>{S.map((s) => { const c = situationCalc(P!.boq, S, s); return (
              <tr key={s.id}><td><b>{s.no}</b></td><td>{s.kind === 'fin' ? 'окончателна' : 'привремена'}</td><td>{dmy(s.date)}</td><td>{dmy(s.from)} – {dmy(s.to)}</td><td className="n">{fmt(c.cur)}</td><td className="n">{fmt(c.cum)} <span className="mini">{c.pct}%</span></td>
                <td>{s.invoiceId ? <span className="pill good">{inv.get(s.invoiceId)}</span> : <span className="pill">нема</span>}</td><td><Link className="btn sm" href={href({ t: 'sit', s: s.id })}>Отвори</Link></td></tr>); })}
              {!S.length && <tr><td colSpan={8} className="note">Нема ситуации.</td></tr>}</tbody></table></div></>
      );
    } else if (T === 'cost') {
      const [k, un] = await db().transaction(async (tx) => [await projectCosts(tx, firm, P!), await unlinkedCosts(tx, firm.id, P!.start)] as const);
      body = (
        <>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            {([['Фактурирано (ситуации)', k.rev], ['Материјал и подизведувачи', k.pur], ['Готовински трошоци', k.blg], ['Труд и машини (дневник)', k.lab], ['Резултат', k.rev - k.tot]] as const).map(([t, v]) => (
              <div key={t} className="card" style={{ flex: 1, minWidth: 160, margin: 0 }}><div className="mini">{t}</div><div style={{ fontSize: 20, fontWeight: 700, color: v < 0 ? 'var(--bad)' : undefined }}>{fmt(v)}</div></div>))}
          </div>
          <BankForm action={linkCostsAction} className="card"><input type="hidden" name="proj" value={P!.id} /><input type="hidden" name="unlink" value="1" />
            <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Трошоци на објектот</h2>
            <table className="dense"><tbody>{k.L.map((x, i) => <tr key={i}><td>{x.ref && write && <input type="checkbox" name="pc" value={`${x.ref.type}:${x.ref.id}`} style={{ width: 'auto' }} />}</td><td>{dmy(x.d)}</td><td>{x.t}</td><td>{x.who}</td><td className="n">{fmt(x.amt)}</td></tr>)}
              {!k.L.length && <tr><td className="note">Нема.</td></tr>}</tbody></table>
            {write && k.L.some((x) => x.ref) && <div className="row"><span style={{ flex: 1 }} /><button className="btn sm">Откачи ги избраните</button></div>}
          </BankForm>
          {write && <BankForm action={linkCostsAction} className="card"><input type="hidden" name="proj" value={P!.id} />
            <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Поврзи трошоци со објектот</h2>
            <p className="note" style={{ margin: '0 0 6px' }}>Штиклирајте ги влезните фактури (материјал, подизведувачи, кирија на машини) и исплатниците што се за овој објект. Трудот и машините се пресметуваат од дневникот (часови × цена/час).</p>
            <div className="tw" style={{ maxHeight: 340, overflow: 'auto' }}><table className="dense"><tbody>
              {un.P.map((p) => <tr key={p.id}><td><input type="checkbox" name="pc" value={`purchase:${p.id}`} style={{ width: 'auto' }} /></td><td>{dmy(p.date)}</td><td>Влезна {p.number}</td><td>{p.who}</td><td className="n">{fmt(p.base)}</td></tr>)}
              {un.V.map((v) => <tr key={v.id}><td><input type="checkbox" name="pc" value={`cash_voucher:${v.id}`} style={{ width: 'auto' }} /></td><td>{dmy(v.date)}</td><td>Исплатница {v.number}</td><td>{v.who}</td><td className="n">{fmt(v.amt)}</td></tr>)}
            </tbody></table></div>
            <div className="row" style={{ marginTop: 6 }}><span style={{ flex: 1 }} /><button className="btn pri">Поврзи избраните</button></div>
          </BankForm>}
        </>
      );
    } else {
      const D = await db().select().from(constructionDiary).where(eq(constructionDiary.projectId, P!.id)).orderBy(desc(constructionDiary.date));
      const E = sp.d === 'new' ? { id: '', date: today(), weather: 'сончево', temp: '', works: '', mat: '', issues: '', nadzor: '', workers: [], mach: [] } : D.find((x) => x.id === sp.d);
      const emp = E ? await db().select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.firmId, firm.id)).orderBy(asc(employees.name)) : [];
      body = E ? (
        <BankForm action={saveDiaryAction} className="card">
          <input type="hidden" name="id" value={E.id} /><input type="hidden" name="proj" value={P!.id} />
          <div className="form">
            <label className="f">Датум<input name="date" type="date" defaultValue={E.date} /></label>
            <label className="f">Време<select name="weather" defaultValue={E.weather ?? ''}>{['сончево', 'облачно', 'дожд', 'снег', 'ветровито', 'магла'].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="f">Температура °C<input name="temp" type="number" defaultValue={E.temp ?? ''} /></label>
            <label className="f wide">Изведени работи<textarea name="works" rows={3} defaultValue={E.works ?? ''} /></label>
            <label className="f wide">Вграден материјал<textarea name="mat" rows={2} defaultValue={E.mat ?? ''} /></label>
            <label className="f wide">Пречки / забелешки<input name="issues" defaultValue={E.issues ?? ''} /></label>
            <label className="f wide">Забелешка од надзорот<input name="nadzor" defaultValue={E.nadzor ?? ''} /></label>
          </div>
          <h3 className="fh" style={{ marginTop: 10 }}>Работници</h3>
          <table className="dense"><tbody>{emp.map((e) => { const w = E.workers.find((x) => x.emp === e.id); return (
            <tr key={e.id}><td><label className="chk"><input type="checkbox" name="w" value={e.id} defaultChecked={!!w} /> {e.name}</label><input type="hidden" name={`wn.${e.id}`} value={e.name} /></td>
              <td><input name={`wh.${e.id}`} type="number" step="any" defaultValue={w?.hrs ?? 8} style={{ width: 70 }} /> часа</td></tr>); })}
            {!emp.length && <tr><td className="note">Нема вработени.</td></tr>}</tbody></table>
          <h3 className="fh" style={{ marginTop: 10 }}>Машини</h3>
          {[...E.mach, ...Array(2).fill({ name: '', hrs: '', rate: '' })].map((x, i) => (
            <div key={i} className="row" style={{ gap: 6, margin: '3px 0' }}><input name={`m.name.${i}`} defaultValue={x.name} style={{ width: 200 }} placeholder="Багер" />
              <input name={`m.hrs.${i}`} type="number" step="any" defaultValue={x.hrs} style={{ width: 70 }} /> ч × <input name={`m.rate.${i}`} type="number" step="any" defaultValue={x.rate} style={{ width: 90 }} /> ден/ч</div>))}
          <div className="row" style={{ gap: 8, marginTop: 10 }}><span style={{ flex: 1 }} /><Link className="btn" href={href({ t: 'dn' })}>Откажи</Link>{write && <button className="btn pri">Зачувај</button>}</div>
        </BankForm>
      ) : (
        <>{write && <div className="row" style={{ gap: 8, marginBottom: 8 }}><Link className="btn pri" href={href({ t: 'dn', d: 'new' })}>+ Запис за денес</Link></div>}
          {D.map((d) => <div className="card" key={d.id}><div className="hd"><b>{dmy(d.date)} · {d.weather}{d.temp ? ` ${d.temp}°C` : ''}</b><Link className="btn sm" href={href({ t: 'dn', d: d.id })}>Измени</Link></div>
            <div className="mini">👷 {d.workers.length} работници, {d.workers.reduce((s, w) => s + w.hrs, 0)} ч{d.mach.length ? ' · 🚜 ' + d.mach.map((x) => `${x.name} ${x.hrs}ч`).join(', ') : ''}</div>
            <div>{d.works}</div>{d.issues && <div className="mini" style={{ color: 'var(--bad)' }}>{d.issues}</div>}</div>)}
          {!D.length && <div className="card empty">Нема записи.</div>}</>
      );
    }
    return (
      <>
        <Hd t={P ? `${P.code} · ${P.name}` : 'Нов објект'}><Link className="btn" href="/gradba">← Објекти</Link></Hd>
        {P && T === 'boq' && <ProjectPhotos firmId={firm.id} id={P.id} write={write} />}
        {P && T === 'boq' && write && <div className="row" style={{ gap: 8, marginBottom: 8 }}><XlsxImport action={importBoqAction} fields={{ id: P.id }} template={oxTemplate(CONS_BOQ_IMPORT, [['1.1', 'Ископ на земја', 'м³', 120, 450]])} templateName="Predmer_obrazec.xlsx" label="📥 Предмер од Excel" /></div>}
        {P && <div className="row" style={{ gap: 6, marginBottom: 8 }}>{TABS.map(([k, n]) => <Link key={k} className={`btn ${T === k ? 'pri' : ''}`} href={href({ t: k })}>{n}</Link>)}</div>}
        {body}
      </>
    );
  }

  const inv = new Map((await db().select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firm.id))).map((p) => [p.id, p.name]));
  const R = await db().transaction(async (tx) => Promise.all(all.map(async (P) => {
    const S = sortSituations(await projectSituations(tx, P.id));
    const last = S[S.length - 1];
    return { P, cc: last ? situationCalc(P.boq, S, last) : { cum: 0, pct: 0 }, k: await projectCosts(tx, firm, P) };
  })));
  return (
    <>
      <Hd t="Градежништво – објекти" sub={`${all.length} објекти`}><Link className="btn" href="/gradbaIzv">📈 Анализи</Link>{write && <Link className="btn pri" href="/gradba?p=new">+ Нов објект / проект</Link>}</Hd>
      {write && <div className="row" style={{ gap: 8, marginBottom: 8 }}><XlsxImport action={importProjectsAction} template={oxTemplate(CONS_PROJECT_IMPORT, [['', 'Станбена зграда Центар', 'ул. Македонија 1, КП 1234', 'Скопје', 'Инвеститор ДООЕЛ', '4030000000000', '12/2026', '01.03.2026', '15.03.2026', '31.12.2026', 'Надзор ДОО', 'Инж. Петров', 'да']])} templateName="Objekti_obrazec.xlsx" label="📥 Објекти од Excel" /></div>}
      <div className="tw"><table><thead><tr><th>Шифра</th><th>Објект</th><th>Инвеститор</th><th className="n">Договорено (предмер)</th><th className="n">Изведено</th><th className="n">Фактурирано</th><th className="n">Трошоци</th><th className="n">Резултат</th><th>Статус</th><th /></tr></thead>
        <tbody>{R.map(({ P, cc, k }) => (
          <tr key={P.id}><td>{P.code}</td><td><b>{P.name}</b><div className="mini">{P.site}</div></td><td>{inv.get(P.investorId)}</td><td className="n">{fmt(boqValue(P.boq))}</td><td className="n">{fmt(cc.cum)} <span className="mini">{cc.pct}%</span></td>
            <td className="n">{fmt(k.rev)}</td><td className="n">{fmt(k.tot)}</td><td className="n" style={{ color: k.rev - k.tot < 0 ? 'var(--bad)' : undefined }}>{fmt(k.rev - k.tot)}</td>
            <td><span className={`pill ${P.status === 'done' ? 'good' : 'info'}`}>{P.status === 'done' ? 'завршен' : 'во тек'}</span></td><td><Link className="btn sm" href={`/gradba?p=${P.id}`}>Отвори</Link></td></tr>
        ))}{!all.length && <tr><td colSpan={10} className="note">Нема објекти.</td></tr>}</tbody></table></div>
      <BankForm action={saveConsConfigAction} className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Поставки</h2>
        <div className="form">
          <label className="f">Цена на работен час (трошок, ден.)<input name="hr" type="number" step="any" defaultValue={C.hr} /></label>
          <label className="f">Конто за приход од градежни услуги<input name="revK" defaultValue={C.revK} placeholder="од шемата (услуги)" /></label>
          <label className="f">ДДВ % на ситуациите<select name="rate" defaultValue={String(C.rate)}><option value="18">18%</option><option value="10">10%</option><option value="5">5%</option></select></label>
        </div>
        {write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>}
        <p className="note">Член 32-а од Законот за ДДВ: за градежни услуги кон инвеститор кој е ДДВ обврзник, фактурата е без ДДВ (пренесување на даночната обврска) – се штиклира кај објектот и фактурите од ситуациите автоматски се издаваат така.</p>
      </BankForm>
    </>
  );
}

void and;

/** Legacy `cp_ph` — photos of the project (`file_links` role photo) with „📷 Додај фотографии“. */
async function ProjectPhotos({ firmId, id, write }: { firmId: string; id: string; write: boolean }) {
  const F = await db().transaction((tx) => entityFiles(tx, 'construction_project', [id]));
  return (
    <div className="card"><span className="mini">Фотографии</span>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {F.filter((x) => x.mime.startsWith('image/')).map((x) => <a key={x.id} href={`/api/files/${x.id}`} target="_blank" rel="noopener noreferrer"><img src={`/api/files/${x.id}`} alt={x.name} style={{ height: 64, borderRadius: 6 }} /></a>)}
        {write && <BankForm action={addProjectPhotosAction} className="row" style={{ gap: 6, alignItems: 'center' }}><input type="hidden" name="id" value={id} /><UploadField firmId={firmId} label="📷 Додај фотографии" accept="image/*" capture /><button className="btn sm">Зачувај</button></BankForm>}
      </div>
    </div>
  );
}
