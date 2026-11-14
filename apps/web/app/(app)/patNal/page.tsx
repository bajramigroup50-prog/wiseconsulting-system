/**
 * ✈️ Службени патувања (патни налози) — per employee, in the country and abroad: list of the period, the editor
 * (destination, purpose, vehicle, departure / return, countries with border crossings, costs, advance), the settlement
 * (per diems by the Уредба / the office codebook, own car, costs, advance → to pay / to return), posting through the
 * firm's scheme, prints (Патен налог, Пресметка), the report per employee (Excel) and the codebook.
 */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import {
  BT_COST_KINDS, BT_REDUCTIONS, BT_STATUS, BT_VEHICLES, btByEmployee, btCountries, btCountryName, btEntries, btSettle, type BtSchemeKey, type BusinessTrip,
} from '@wise/core/btrip';
import { schemeValue } from '@wise/core/posting';
import { employees, btripJournals, btripSettings, getBtrip, listBtrips, vatPostingContext, appSettings, SCHEMES_SETTINGS_KEY } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { fxLookup } from '@/lib/fuel';
import { ActionForm, Submit } from '@/components/action-form';
import { ExportXlsx, ListPdf, type Cell } from '@/components/list-tools';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { TripForm } from './trip-form';
import { deleteBtripAction, postBtripAction, saveBtripSettingsAction, unpostBtripAction } from './actions';

type SP = { id?: string; cfg?: string; izv?: string; from?: string; to?: string; emp?: string };
const isD = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const hm = (d: string) => (d ? dmy(d.slice(0, 10)) + ' ' + d.slice(11, 16) : '');

export default async function PatNal({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('patNal');
  if (!firm) return <NoFirm t="Службени патувања" />;
  const ed = canDo(u, 'btSave', firm.id);
  const [E, cfg, fx] = await Promise.all([
    db().select({ id: employees.id, name: employees.name, position: employees.position, active: employees.active }).from(employees).where(eq(employees.firmId, firm.id)).orderBy(asc(employees.name)),
    btripSettings(db(), firm.id),
    fxLookup(firm.id),
  ]);
  const S = cfg.s;
  const C = btCountries(S);
  const name = (id: string) => E.find((e) => e.id === id)?.name ?? '—';
  const from = isD(sp.from) ? sp.from! : `${year}-01-01`, to = isD(sp.to) ? sp.to! : `${year}-12-31`;
  const nav = (
    <>
      <Link className="btn" href="/patNal">📋 Налози</Link>
      <Link className="btn" href={`/patNal?izv=1&from=${from}&to=${to}`}>📊 Извештај по вработен</Link>
      <Link className="btn" href="/patNal?cfg=1">⚙ Шифрарник (дневници)</Link>
    </>
  );

  /* ---------------- codebook ---------------- */
  if (sp.cfg) {
    const ced = canDo(u, 'btCfg', firm.id);
    return (
      <>
        <Hd t="⚙ Шифрарник – дневници и надоместоци" sub="важи за сите фирми на канцеларијата; фирмата може да има своја домашна дневница" exp={false}>{nav}</Hd>
        <ActionForm action={saveBtripSettingsAction} reset={false}>
          <input type="hidden" name="scope" value="firm" />
          <h3 style={{ marginTop: 0 }}>Само за {firm.name}</h3>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <label className="f">Дневница во земјата (ден.)<input name="domAmt" inputMode="decimal" defaultValue={cfg.firm.domAmt ?? ''} placeholder={String(btripOffice(cfg).domAmt)} disabled={!ced} /></label>
            <label className="f">Сопствено возило – % од цена на гориво по км<input name="carPct" inputMode="decimal" defaultValue={cfg.firm.carPct ?? ''} placeholder={String(btripOffice(cfg).carPct)} disabled={!ced} /></label>
            <label className="f">Цена на литар гориво (ден.)<input name="fuelPrice" inputMode="decimal" defaultValue={cfg.firm.fuelPrice ?? ''} placeholder={String(btripOffice(cfg).fuelPrice)} disabled={!ced} /></label>
          </div>
          <p className="note">Празно = вредноста на канцеларијата. Ако колективниот договор / одлуката на фирмата предвидува друга дневница, внесете ја тука.</p>
          {ced && <Submit>💾 Зачувај за фирмата</Submit>}
        </ActionForm>
        <ActionForm action={saveBtripSettingsAction} reset={false}>
          <input type="hidden" name="scope" value="office" />
          <h3 style={{ marginTop: 0 }}>За целата канцеларија</h3>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <label className="f">Дневница во земјата (ден.)<input name="domAmt" inputMode="decimal" defaultValue={cfg.office.domAmt ?? ''} placeholder="3700" disabled={!ced} /></label>
            <label className="f">Сопствено возило – %<input name="carPct" inputMode="decimal" defaultValue={cfg.office.carPct ?? ''} placeholder="30" disabled={!ced} /></label>
            <label className="f">Цена на литар гориво (ден.)<input name="fuelPrice" inputMode="decimal" defaultValue={cfg.office.fuelPrice ?? ''} placeholder="80" disabled={!ced} /></label>
          </div>
          <p className="note">Дневницата во земјата не се оданочува до 8% од просечната месечна нето плата во РСМ во последните 3 месеци (ЗПДД) – проверете ја просечната нето плата на ДЗС и ажурирајте. Надомест за сопствено возило: 30% од цената на литар гориво по поминат километар.</p>
          <h4>Дневници во странство по држава (Уредба за издатоците за службени патувања и селидби во странство)</h4>
          <div className="tw"><table className="dense"><thead><tr><th>Држава</th><th className="n">По Уредба</th><th>Износ на канцеларијата</th><th>Валута</th></tr></thead>
            <tbody>{C.map((c) => (
              <tr key={c.c}><td>{c.n}</td><td className="n">{c.def} {c.defCur}</td>
                <td><input name={`rate.${c.c}`} inputMode="decimal" defaultValue={S.rates[c.c]?.[0] ?? ''} placeholder={String(c.def)} style={{ width: 80 }} disabled={!ced} /></td>
                <td><select name={`cur.${c.c}`} defaultValue={c.cur} disabled={!ced}>{['EUR', 'USD', 'CHF', 'GBP'].map((x) => <option key={x}>{x}</option>)}</select></td></tr>))}</tbody></table></div>
          {ced && <Submit>💾 Зачувај за канцеларијата</Submit>}
        </ActionForm>
      </>
    );
  }

  /* ---------------- editor ---------------- */
  if (sp.id) {
    const row = sp.id === 'new' ? null : await getBtrip(db(), firm.id, sp.id);
    if (sp.id !== 'new' && !row) return <><Hd t="Патен налог" exp={false}>{nav}</Hd><div className="card empty">Налогот не постои.</div></>;
    const now = new Date().toISOString().slice(0, 10);
    const t: BusinessTrip = row?.data ?? { number: '', date: now, employeeId: sp.emp ?? '', abroad: false, dest: '', country: '', purpose: '', vehicle: 'company', dep: `${now}T07:00`, ret: `${now}T17:00`, red: 100, costs: [], advCur: 'MKD', status: 'open' };
    if (row) t.status = row.status as BusinessTrip['status'];
    const st = row ? btSettle(t, S, fx) : null;
    let journal: string | null = null, lines: ReturnType<typeof btEntries> = [];
    if (row && st) {
      journal = (await btripJournals(db(), firm.id)).get(row.id) ?? null;
      const [g] = await db().select().from(appSettings).where(eq(appSettings.key, SCHEMES_SETTINGS_KEY)).limit(1);
      const ctx = vatPostingContext(firm, g?.value ?? null);
      lines = btEntries(t, st, (k: BtSchemeKey) => schemeValue(ctx, k), name(t.employeeId));
    }
    const post = canDo(u, 'btPost', firm.id);
    return (
      <>
        <Hd t={row ? `✈️ Патен налог ${row.number}` : '✈️ Нов патен налог'} sub={row ? `${name(t.employeeId)} · ${t.dest} · ${BT_STATUS[(row.status as keyof typeof BT_STATUS) ?? 'open']?.[0] ?? ''}` : firm.name} exp={false}>
          {nav}
          {row && <Link className="btn" href={`/patNal/print?id=${row.id}&f=nalog`} target="_blank">🖨 Патен налог</Link>}
          {row && <Link className="btn" href={`/patNal/print?id=${row.id}&f=presmetka`} target="_blank">🖨 Пресметка</Link>}
        </Hd>
        {!E.length && <div className="callout warn">Фирмата нема вработени – прво внесете ги во <Link href="/vraboteni">Матични податоци за вработени</Link>.</div>}
        <TripForm id={row?.id ?? ''} t={t} employees={E.filter((e) => e.active !== false || e.id === t.employeeId)} countries={C} ed={ed} />
        {row && st && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Пресметка</h3>
            {st.miss.length > 0 && <div className="callout warn">Нема курс на НБРМ за: {st.miss.join(', ')} (за датумот на враќање) – внесете го курсот во Курсна листа.</div>}
            <table className="dense"><thead><tr><th>Држава</th><th>Од</th><th>До</th><th className="n">Часови</th><th className="n">Дневници</th><th className="n">Дневница</th><th className="n">Износ</th><th className="n">Курс</th><th className="n">Денари</th></tr></thead>
              <tbody>{st.rows.map((r, i) => (
                <tr key={i}><td>{btCountryName(r.c)}</td><td>{hm(r.in)}</td><td>{hm(r.out)}</td><td className="n">{r.hrs ?? ''}</td><td className="n">{r.u}</td><td className="n">{fmt(r.amt)} {r.cur}</td><td className="n">{fmt(r.v)} {r.cur}</td><td className="n">{r.fx}</td><td className="n">{fmt(r.m)}</td></tr>))}</tbody></table>
            {Number(t.red ?? 100) < 100 && <p className="note">Намалување: {BT_REDUCTIONS.find((x) => x[0] === Number(t.red))?.[1] ?? `${t.red}%`}</p>}
            <table className="dense" style={{ marginTop: 8, maxWidth: 480 }}><tbody>
              <tr><td>Дневници ({st.units})</td><td className="n">{fmt(st.perDiem)}</td></tr>
              {st.car > 0 && <tr><td>Сопствено возило ({t.km} км × {fmt(S.fuelPrice)} × {S.carPct}%)</td><td className="n">{fmt(st.car)}</td></tr>}
              {st.costs.map((c, i) => <tr key={i}><td>{BT_COST_KINDS.find((k) => k[0] === c.k)?.[1].split(' (')[0]}: {c.d} {c.cur !== 'MKD' ? `(${fmt(c.amt)} ${c.cur} × ${c.fx})` : ''}</td><td className="n">{fmt(c.m)}</td></tr>)}
              <tr><th>Вкупно трошоци</th><th className="n">{fmt(st.total)}</th></tr>
              <tr><td>Примена аконтација</td><td className="n">{fmt(st.advance)}</td></tr>
              {st.toPay > 0 && <tr><th>За исплата на вработениот</th><th className="n">{fmt(st.toPay)}</th></tr>}
              {st.toReturn > 0 && <tr><th>За враќање од вработениот</th><th className="n">{fmt(st.toReturn)}</th></tr>}
            </tbody></table>
            <h4>Книжење {journal && <span className="badge good">налог {journal}</span>}</h4>
            <table className="dense" style={{ maxWidth: 640 }}><thead><tr><th>Конто</th><th>Опис</th><th className="n">Должи</th><th className="n">Побарува</th></tr></thead>
              <tbody>{lines.map((l, i) => <tr key={i}><td>{l.account}</td><td>{l.note}</td><td className="n">{l.debit ? fmt(l.debit) : ''}</td><td className="n">{l.credit ? fmt(l.credit) : ''}</td></tr>)}</tbody></table>
            {st.toReturn > 0 && <p className="note">Неискористената аконтација ({fmt(st.toReturn)}) останува на побарувањето од вработениот (143x) додека не ја врати.</p>}
            <p className="note">Контата се од шемата за книжење на фирмата (Систем › Шеми за автоматско книжење › Службени патувања). Исплатата на аконтацијата (Д 143x / П банка или благајна) се книжи со изводот / благајната.</p>
            <div className="row" style={{ gap: 8 }}>
              {post && row.status !== 'cancel' && <RowAction className="btn pri" action={postBtripAction.bind(null, row.id)} label={journal ? '📒 Книжи повторно' : '📒 Книжи'} showOk />}
              {post && journal && <RowAction className="btn" action={unpostBtripAction.bind(null, row.id)} label="↩ Откнижи" confirm="Да се избрише книжењето на налогот?" showOk />}
              {canDo(u, 'del', firm.id) && <RowAction className="btn ghost" action={deleteBtripAction.bind(null, row.id)} label="🗑 Избриши" confirm={`Да се избрише патниот налог ${row.number}${journal ? ' и неговото книжење' : ''}?`} okHref="/patNal" okLink="← Налози" inline />}
            </div>
          </div>
        )}
      </>
    );
  }

  /* ---------------- list / report ---------------- */
  const all = await listBtrips(db(), firm.id);
  const J = await btripJournals(db(), firm.id);
  const L = all.filter((r) => r.date >= from && r.date <= to && (!sp.emp || r.data.employeeId === sp.emp)).map((r) => ({ ...r, employeeId: r.data.employeeId, status: r.status as BusinessTrip['status'], st: btSettle(r.data, S, fx) }));
  const filter = (
    <form className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {sp.izv && <input type="hidden" name="izv" value="1" />}
      <label className="f">Од<input type="date" name="from" defaultValue={from} /></label>
      <label className="f">До<input type="date" name="to" defaultValue={to} /></label>
      <label className="f">Вработен<select name="emp" defaultValue={sp.emp ?? ''}><option value="">Сите</option>{E.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <button className="btn">Прикажи</button>
    </form>
  );
  if (sp.izv) {
    const R = btByEmployee(L).sort((a, b) => name(a.employeeId).localeCompare(name(b.employeeId)));
    const tot = btByEmployee(L.map((x) => ({ ...x, employeeId: '*' })))[0];
    const H = ['Вработен', 'Налози', 'Дневници (бр.)', 'Дневници', 'Сопствено возило', 'Превоз', 'Сместување', 'Останато', 'Вкупно', 'Аконтации', 'За исплата', 'За враќање'];
    const rowOf = (r: NonNullable<typeof tot>, nm: string): Cell[] => [nm, r.n, r.days, r.perDiem, r.car, r.transport, r.lodging, r.other, r.total, r.advance, r.toPay, r.toReturn];
    const detail: Cell[][] = [['Број', 'Датум', 'Вработен', 'Вид', 'Дестинација', 'Цел', 'Поаѓање', 'Враќање', 'Дневници (бр.)', 'Дневници', 'Сопствено возило', 'Превоз', 'Сместување', 'Останато', 'Вкупно', 'Аконтација', 'За исплата', 'За враќање', 'Статус', 'Налог'],
      ...L.map((x) => [x.number, x.date, name(x.employeeId), x.data.abroad ? 'странство' : 'земја', x.data.dest, x.data.purpose, x.data.dep.replace('T', ' '), x.data.ret.replace('T', ' '), x.st.units, x.st.perDiem, x.st.car, x.st.transport, x.st.lodging, x.st.other, x.st.total, x.st.advance, x.st.toPay, x.st.toReturn, BT_STATUS[x.status ?? 'open']?.[0] ?? '', J.get(x.id) ?? ''])];
    return (
      <>
        <Hd t="📊 Службени патувања по вработен" sub={`${firm.name} · ${dmy(from)} – ${dmy(to)}`} exp={false}>
          {nav}
          <ExportXlsx name={`Sluzbeni_patuvanja_${from}_${to}.xlsx`} sheets={[{ name: 'По вработен', rows: [H, ...R.map((r) => rowOf(r, name(r.employeeId))), ...(tot ? [rowOf(tot, 'ВКУПНО')] : [])] }, { name: 'Налози', rows: detail }]} />
          <ListPdf target="btIzv" title={`Службени патувања ${dmy(from)} – ${dmy(to)}`} landscape />
        </Hd>
        {filter}
        <div className="tw" id="btIzv"><table><thead><tr>{H.map((h, i) => <th key={h} className={i ? 'n' : ''}>{h}</th>)}</tr></thead>
          <tbody>{R.map((r) => <tr key={r.employeeId}>{rowOf(r, name(r.employeeId)).map((c, i) => <td key={i} className={i ? 'n' : ''}>{i === 0 ? <Link href={`/patNal?emp=${r.employeeId}&from=${from}&to=${to}`}>{c}</Link> : i > 2 ? fmt(c as number) : c}</td>)}</tr>)}</tbody>
          {tot && <tfoot><tr>{rowOf(tot, 'Вкупно').map((c, i) => <th key={i} className={i ? 'n' : ''}>{i > 2 ? fmt(c as number) : c}</th>)}</tr></tfoot>}
        </table></div>
        {!R.length && <div className="card empty">Нема патни налози во периодот.</div>}
      </>
    );
  }
  const xlsx: Cell[][] = [['Број', 'Датум', 'Вработен', 'Дестинација', 'Цел', 'Поаѓање', 'Враќање', 'Дневници', 'Вкупно', 'Аконтација', 'За исплата', 'За враќање', 'Статус', 'Налог'],
    ...L.map((x) => [x.number, x.date, name(x.employeeId), x.data.dest, x.data.purpose, x.data.dep.replace('T', ' '), x.data.ret.replace('T', ' '), x.st.units, x.st.total, x.st.advance, x.st.toPay, x.st.toReturn, BT_STATUS[x.status ?? 'open']?.[0] ?? '', J.get(x.id) ?? ''])];
  return (
    <>
      <Hd t="✈️ Службени патувања (патни налози)" sub={`${firm.name} · ${dmy(from)} – ${dmy(to)}`} exp={false}>
        {ed && <Link className="btn pri" href={`/patNal?id=new${sp.emp ? `&emp=${sp.emp}` : ''}`}>+ Нов патен налог</Link>}
        {nav}
        <ExportXlsx name={`Patni_nalozi_${from}_${to}.xlsx`} rows={xlsx} />
        <ListPdf target="btList" title={`Патни налози ${dmy(from)} – ${dmy(to)}`} landscape />
      </Hd>
      {filter}
      {L.length ? (
        <div className="tw" id="btList"><table><thead><tr><th>Број</th><th>Датум</th><th>Вработен</th><th>Дестинација</th><th>Цел</th><th>Период</th><th className="n">Дневници</th><th className="n">Вкупно</th><th className="n">Аконтација</th><th className="n">За исплата / враќање</th><th>Статус</th><th /></tr></thead>
          <tbody>{L.map((x) => {
            const s0 = BT_STATUS[x.status ?? 'open'] ?? BT_STATUS.open;
            return (
              <tr key={x.id}>
                <td><Link href={`/patNal?id=${x.id}`}><b>{x.number}</b></Link></td><td>{dmy(x.date)}</td><td>{name(x.employeeId)}</td>
                <td>{x.data.abroad ? '🌍 ' : ''}{x.data.dest}{x.data.abroad && x.data.country ? `, ${btCountryName(x.data.country)}` : ''}</td><td>{x.data.purpose}</td>
                <td>{hm(x.data.dep)} – {hm(x.data.ret)}</td><td className="n">{x.st.units}</td><td className="n">{fmt(x.st.total)}</td><td className="n">{fmt(x.st.advance)}</td>
                <td className="n">{x.st.toPay ? fmt(x.st.toPay) : x.st.toReturn ? `−${fmt(x.st.toReturn)}` : '0,00'}</td>
                <td><span className={`badge ${s0[1]}`}>{s0[0]}</span>{J.get(x.id) ? ` · ${J.get(x.id)}` : ''}</td>
                <td><Link className="btn sm" href={`/patNal/print?id=${x.id}&f=nalog`} target="_blank">🖨</Link></td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr><th colSpan={6}>Вкупно {L.length}</th><th className="n">{L.reduce((a, x) => a + x.st.units, 0)}</th><th className="n">{fmt(L.reduce((a, x) => a + x.st.total, 0))}</th><th className="n">{fmt(L.reduce((a, x) => a + x.st.advance, 0))}</th><th colSpan={3} /></tr></tfoot>
        </table></div>
      ) : (
        <div className="card empty">
          Нема патни налози во периодот. {ed && <Link href="/patNal?id=new">+ Нов патен налог</Link>}
          <p className="note">Патен налог за службено патување во земјата или во странство: дневници според Уредбата (по држава) и домашната дневница од шифрарникот, превоз, сместување, сопствено возило, аконтација → пресметка, печатење и книжење.</p>
        </div>
      )}
      <p className="note">Возила: {BT_VEHICLES.map((v) => v[1]).join(' · ')}. Возачите во меѓународен превоз имаат свои дневници во „Дневници во странство“.</p>
    </>
  );
}

function btripOffice(cfg: { office: Partial<{ domAmt: number; carPct: number; fuelPrice: number }> }) {
  return { domAmt: cfg.office.domAmt ?? 3700, carPct: cfg.office.carPct ?? 30, fuelPrice: cfg.office.fuelPrice ?? 80 };
}
