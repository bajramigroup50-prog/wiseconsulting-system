/**
 * „🍲 Корисници и оброци“ (module `meals`) — for humanitarian associations (народна кујна): the daily list of who came
 * and which meal they took, the register of families / persons (with the import of the association's Excel register),
 * and reports for a month, a quarter or any period: meals and portions per family, and the movements of the books
 * (расходи кл. 4, приходи кл. 7) with the cost per portion. The association's own user (client portal) sees this
 * screen when the office switches on the section „Корисници и оброци“.
 */
import Link from 'next/link';
import { costPerPortion, MEALS, monthSummary, registerSummary } from '@wise/core/meals';
import { withoutConsent } from '@wise/core/npo';
import { consentFiles, listBeneficiaries, listMembers, mealLogsBetween, npoMovements } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { PdfButton } from '@/components/pdf-button';
import { XlsxButton } from '@/components/vp-tools';
import { UploadField } from '@/components/upload-field';
import { consentAction, importBenefAction, saveBenefAction } from './actions';
import { DayList } from './day-list';
import { FitDoc } from '@/components/fit-doc';
import { ConsentDoc, ProcessingRecords } from './docs';
import { KitchenReport, KitchenTab } from './kitchen';

const T = 'Корисници и оброци';
const isIso = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Period of the report: `p=m` month (`m=YYYY-MM`), `p=q` quarter (`q=YYYY-Qn`), `p=r` from / to. */
function period(sp: { p?: string; m?: string; q?: string; od?: string; do?: string }, d: string) {
  const [y, mo] = d.split('-').map(Number) as [number, number];
  if (sp.p === 'r' && isIso(sp.od) && isIso(sp.do) && sp.od! <= sp.do!) return { from: sp.od!, to: sp.do!, label: `${dmy(sp.od!)} – ${dmy(sp.do!)}` };
  if (sp.p === 'q') {
    const m = /^(\d{4})-Q([1-4])$/.exec(sp.q ?? '');
    const qy = m ? Number(m[1]) : y, q = m ? Number(m[2]) : Math.ceil(mo / 3);
    const m1 = (q - 1) * 3 + 1, m3 = m1 + 2;
    return { from: `${qy}-${String(m1).padStart(2, '0')}-01`, to: `${qy}-${String(m3).padStart(2, '0')}-${lastDay(qy, m3)}`, label: `${q}. квартал ${qy}` };
  }
  const mm = /^(\d{4})-(\d{2})$/.exec(sp.m ?? '');
  const my = mm ? Number(mm[1]) : y, mn = mm ? Number(mm[2]) : mo;
  return { from: `${my}-${String(mn).padStart(2, '0')}-01`, to: `${my}-${String(mn).padStart(2, '0')}-${lastDay(my, mn)}`, label: `${String(mn).padStart(2, '0')}.${my}` };
}

export default async function Obroci({ searchParams }: { searchParams: Promise<{ t?: string; d?: string; id?: string; nov?: string; p?: string; m?: string; q?: string; od?: string; do?: string; all?: string; sm?: string; nc?: string; sog?: string; pr?: string; nd?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('obroci', T);
  if (g.blocked) return g.blocked;
  const { firm, write } = g;
  const tab = sp.t === 'k' || sp.t === 'i' || sp.t === 'z' || sp.t === 'e' ? sp.t : 'd';
  const D = isIso(sp.d) ? sp.d! : today();
  const B = await listBeneficiaries(db(), firm.id, tab === 'k' && sp.all === '1');
  const Tabs = (
    <div className="row" style={{ gap: 6, margin: '6px 0 10px' }}>
      <Link className={'btn' + (tab === 'd' ? ' pri' : '')} href={`/obroci?d=${D}`}>📋 Дневна листа</Link>
      <Link className={'btn' + (tab === 'k' ? ' pri' : '')} href="/obroci?t=k">👪 Корисници ({B.filter((b) => b.active).length})</Link>
      <Link className={'btn' + (tab === 'i' ? ' pri' : '')} href="/obroci?t=i">📊 Извештаи</Link>
      <Link className={'btn' + (tab === 'z' ? ' pri' : '')} href="/obroci?t=z">🥫 Кујна – залиха</Link>
      <Link className={'btn' + (tab === 'e' ? ' pri' : '')} href="/obroci?t=e">🔒 Лични податоци</Link>
      <Link className="btn" href="/clenovi">🧑‍🤝‍🧑 Регистар на членови</Link>
    </div>
  );

  // ---- daily list
  if (tab === 'd') {
    const L = await mealLogsBetween(db(), firm.id, D, D);
    const prev = new Date(Date.parse(D) - 864e5).toISOString().slice(0, 10), next = new Date(Date.parse(D) + 864e5).toISOString().slice(0, 10);
    return (
      <>
        <Hd t={'🍲 ' + T} sub={`дневна листа · ${dmy(D)}`} />
        {Tabs}
        <form className="row" style={{ gap: 8, alignItems: 'end' }}>
          <Link className="btn sm" href={`/obroci?d=${prev}`}>◀</Link>
          <label className="f">Датум<input type="date" name="d" defaultValue={D} /></label>
          <button className="btn">Прикажи</button>
          <Link className="btn sm" href={`/obroci?d=${next}`}>▶</Link>
          {D !== today() && <Link className="btn sm" href="/obroci">Денес</Link>}
        </form>
        <DayList key={D} date={D} write={write} taken={L.map((x) => `${x.beneficiaryId}:${x.meal}`)}
          rows={B.map((b) => ({ id: b.id, no: b.no, name: b.name, members: b.members, place: b.place }))} />
        <p className="note">Секој клик се зачувува веднаш. „Порции“ = оброци × членови на семејството.</p>
      </>
    );
  }

  // ---- register
  if (tab === 'k' && sp.sog) {
    // printable consent of one beneficiary, or of everyone still without a consent (`sog=all`)
    const one = sp.sog !== 'all' ? B.find((b) => b.id === sp.sog) ?? (await listBeneficiaries(db(), firm.id, true)).find((b) => b.id === sp.sog) : null;
    const list = one ? [one] : withoutConsent(B);
    const F = one ? await consentFiles(db(), [one.id]) : new Map<string, string[]>();
    return (
      <>
        <Hd t={'🍲 ' + T} sub={one ? `согласност за лични податоци · ${one.name}` : `согласности за ${list.length} корисници без согласност`} exp={false} excel={false}>
          <PdfButton selector="#consentDocs" title={one ? `Согласност ${one.name}` : 'Согласности'} />
          <Link className="btn" href="/obroci?t=k">← Регистар</Link>
        </Hd>
        {Tabs}
        {one && write && (
          <div className="card">
            <BankForm action={consentAction}>
              <input type="hidden" name="id" value={one.id} />
              <div className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                <label className="f">Датум на потпишаната согласност<input type="date" name="consentDate" defaultValue={one.consentDate ?? ''} /></label>
                <UploadField firmId={firm.id} label="📎 Скенирана потпишана согласност" accept="application/pdf,image/*" />
                <button className="btn pri">Зачувај</button>
                {(F.get(one.id) ?? []).map((f, i) => <a key={f} className="btn sm" href={`/api/files/${f}`} target="_blank" rel="noopener">📎 {i + 1}</a>)}
              </div>
              <p className="mini">Испечатете ја, корисникот ја потпишува, внесете го датумот и прикачете ја скенираната. Празен датум = без согласност.</p>
            </BankForm>
          </div>
        )}
        <div className="pdfwrap">
          {list.length ? <FitDoc width="190mm"><div id="consentDocs">
            {list.map((b, i) => <div key={b.id} className="pdfdoc" style={{ margin: '0 0 8mm', ...(i ? { breakBefore: 'page' as const } : {}) }}><ConsentDoc b={b} firm={firm} /></div>)}
          </div></FitDoc> : <p className="muted">Сите активни корисници имаат согласност.</p>}
        </div>
      </>
    );
  }

  if (tab === 'e') {
    const [all, M] = await Promise.all([listBeneficiaries(db(), firm.id, true), listMembers(db(), firm.id)]);
    const act = all.filter((b) => b.active), no = withoutConsent(all);
    return (
      <>
        <Hd t={'🍲 ' + T} sub="лични податоци (ЗЗЛП) · согласности и евиденција на активности за обработка" exp={false} excel={false}>
          <PdfButton selector="#zzlpRec" title={`Евиденција на активности за обработка – ${firm.name}`} landscape />
        </Hd>
        {Tabs}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
          <span className="pill">Активни корисници: <b>{act.length}</b></span>
          <span className="pill good">Со согласност: <b>{act.length - no.length}</b></span>
          <Link className={'pill' + (no.length ? ' bad' : '')} href="/obroci?t=k&nc=1">Без согласност: <b>{no.length}</b></Link>
          {no.length > 0 && <Link className="btn sm" href="/obroci?t=k&sog=all">🖨 Согласности за сите без согласност</Link>}
        </div>
        <p className="note">Податоците за социјалната и здравствената состојба се посебна категорија лични податоци – се обработуваат само со изречна писмена согласност. Евиденцијата подолу е пополнета со податоците на здружението; проверете ја и потпишете ја.</p>
        <div className="card"><div className="pdfwrap"><FitDoc width="277mm"><div id="zzlpRec" className="pdfdoc land">
          <ProcessingRecords firm={firm} today={today()} counts={{ benef: act.length, members: M.filter((m) => !m.left).length }} />
        </div></FitDoc></div></div>
      </>
    );
  }

  if (tab === 'z') {
    const P = period({ ...sp, p: sp.od && sp.do ? 'r' : sp.p }, D);
    return (
      <>
        <Hd t={'🍲 ' + T} sub="кујна – залиха, норматив, издатници и приемници на донации" exp={false} excel={false} />
        {Tabs}
        <KitchenTab firm={firm} write={write} from={P.from} to={P.to} pr={sp.pr} nd={sp.nd} />
      </>
    );
  }

  if (tab === 'k') {
    const E = sp.id ? B.find((b) => b.id === sp.id) : null;
    const BB = sp.nc === '1' ? withoutConsent(B) : B;
    const noC = withoutConsent(B).length;
    const showForm = write && (!!E || sp.nov === '1');
    return (
      <>
        <Hd t={'🍲 ' + T} sub="регистар на семејства / лица">
          {write && <Link className="btn pri" href="/obroci?t=k&nov=1">+ Нов корисник</Link>}
          {sp.all === '1' ? <Link className="btn" href="/obroci?t=k">Само активни</Link> : <Link className="btn" href="/obroci?t=k&all=1">Прикажи и неактивни</Link>}
          {sp.nc === '1' ? <Link className="btn" href="/obroci?t=k">Сите</Link> : <Link className="btn" href="/obroci?t=k&nc=1">Без согласност ({noC})</Link>}
          {noC > 0 && <Link className="btn" href="/obroci?t=k&sog=all">🖨 Согласности (празни)</Link>}
        </Hd>
        {Tabs}
        {showForm && (
          <div className="card">
            <h2 style={{ margin: '0 0 6px' }}>{E ? `✎ ${E.name}` : '+ Нов корисник'}</h2>
            <BankForm action={saveBenefAction}>
              <input type="hidden" name="id" value={E?.id ?? ''} />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="f" style={{ width: 70 }}>Бр.<input name="no" defaultValue={E?.no ?? ''} inputMode="numeric" /></label>
                <label className="f" style={{ minWidth: 240 }}>Име и презиме (носител)<input name="name" required defaultValue={E?.name ?? ''} /></label>
                <label className="f" style={{ width: 90 }}>Членови<input name="members" type="number" min={1} max={50} defaultValue={E?.members ?? 1} /></label>
                <label className="f">Националност<input name="nationality" defaultValue={E?.nationality ?? ''} /></label>
                <label className="f">ЕМБГ<input name="embg" defaultValue={E?.embg ?? ''} inputMode="numeric" maxLength={13} /></label>
                <label className="f">Место / населба<input name="place" defaultValue={E?.place ?? ''} /></label>
                <label className="f">Телефон<input name="phone" defaultValue={E?.phone ?? ''} /></label>
                {E && <label className="f">Статус<select name="active" defaultValue={E.active ? 'on' : 'off'}><option value="on">активен</option><option value="off">неактивен (не доаѓа повеќе)</option></select></label>}
              </div>
              <label className="f" style={{ display: 'block', marginTop: 6 }}>Опис / состојба<textarea name="note" rows={2} defaultValue={E?.note ?? ''} style={{ width: '100%' }} /></label>
              <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn pri">Зачувај</button><Link className="btn" href="/obroci?t=k">Откажи</Link></div>
            </BankForm>
          </div>
        )}
        {write && (
          <details className="card" open={!B.length}>
            <summary>⬆ Увоз од Excel (регистарот на здружението)</summary>
            <p className="mini">Колони: Nr. · Emri dhe Mbiemri · Anëtarë · Nacionaliteti · Përshkrimi / Gjendja · Numri Amë · Vendbanimi · Kontakt (или на македонски). Постоечките (ист ЕМБГ, или исто име) се ажурираат, новите се додаваат.</p>
            <BankForm action={importBenefAction}>
              <div className="row" style={{ gap: 8, alignItems: 'end' }}>
                <input type="file" name="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" required />
                <button className="btn pri">Увези</button>
              </div>
            </BankForm>
          </details>
        )}
        <div id="obrociReg">
          <table className="dense">
            <thead><tr><th>Бр.</th><th>Име и презиме</th><th className="n">Чл.</th><th>Нац.</th><th>ЕМБГ</th><th>Место</th><th>Телефон</th><th>Опис / состојба</th><th>Согласност</th>{write && <th />}</tr></thead>
            <tbody>
              {BB.map((b) => (
                <tr key={b.id} style={b.active ? undefined : { opacity: 0.55 }}>
                  <td>{b.no ?? ''}</td><td>{b.name}{!b.active && ' (неактивен)'}</td><td className="n">{b.members}</td><td>{b.nationality ?? ''}</td>
                  <td>{b.embg ?? ''}</td><td>{b.place ?? ''}</td><td>{b.phone ?? ''}</td><td className="mini">{b.note ?? ''}</td>
                  <td><Link href={`/obroci?t=k&sog=${b.id}`} className={'pill' + (b.consentDate ? ' good' : ' bad')} title="Образец за согласност (mk / sq), датум и скен">{b.consentDate ? `✓ ${dmy(b.consentDate)}` : 'без согласност'}</Link></td>
                  {write && <td><Link className="btn sm" href={`/obroci?t=k&id=${b.id}${sp.all === '1' ? '&all=1' : ''}`}>✎</Link></td>}
                </tr>
              ))}
              {!BB.length && <tr><td colSpan={10} className="muted">Нема корисници – додајте ги или увезете го Excel регистарот.</td></tr>}
            </tbody>
            <tfoot><tr className="tot"><td /><td>Вкупно {BB.length} семејства / лица</td><td className="n">{BB.reduce((s, b) => s + b.members, 0)}</td><td colSpan={write ? 7 : 6} /></tr></tfoot>
          </table>
        </div>
      </>
    );
  }

  // ---- reports
  const P = period(sp, D);
  const all = await listBeneficiaries(db(), firm.id, true);
  const [L, M] = await Promise.all([mealLogsBetween(db(), firm.id, P.from, P.to), npoMovements(db(), firm.id, P.from, P.to)]);
  const S = monthSummary(all.map((b) => ({ id: b.id, members: b.members })), L);
  const byId = new Map(all.map((b) => [b.id, b]));
  const name = (id: string) => byId.get(id)?.name ?? '';
  // every active family (0 meals too, so an imported register never looks empty); inactive ones only when they ate in the period; `sm=1` = only with meals
  const onlyMeals = sp.sm === '1';
  const rows = S.rows.filter((r) => (onlyMeals ? r.meals > 0 : r.meals > 0 || byId.get(r.id)?.active)).sort((a, b) => (byId.get(a.id)?.no ?? 1e9) - (byId.get(b.id)?.no ?? 1e9) || name(a.id).localeCompare(name(b.id), 'mk'));
  const RS = registerSummary(all.filter((b) => b.active));
  const exp = M.filter((x) => x.account.startsWith('4')), inc = M.filter((x) => x.account.startsWith('7'));
  const expTot = exp.reduce((s, x) => s + x.debit - x.credit, 0), incTot = inc.reduce((s, x) => s + x.credit - x.debit, 0);
  const days = new Set(L.map((x) => x.date)).size;
  const [y, mo] = D.split('-').map(Number) as [number, number];
  const ym = sp.m ?? `${y}-${String(mo).padStart(2, '0')}`, yq = sp.q ?? `${y}-Q${Math.ceil(mo / 3)}`;
  return (
    <>
      <Hd t={'🍲 ' + T} sub={`извештај · ${P.label}`} exp={false} excel={false}>
        <PdfButton selector="#obrociRep" title={`Корисници и оброци ${P.label}`} landscape />
        <XlsxButton name={`obroci-${P.from}-${P.to}`} sheets={[
          { name: 'Оброци', rows: [['Бр.', 'Корисник', 'Членови', 'Денови', 'Појадок', 'Ручек', 'Вечера', 'Оброци', 'Порции'], ...rows.map((r) => [byId.get(r.id)?.no ?? '', name(r.id), byId.get(r.id)?.members ?? 1, r.days, r.b, r.l, r.d, r.meals, r.portions])] },
          { name: 'Движења', rows: [['Конто', 'Назив', 'Должи', 'Побарува', 'Салдо'], ...M.map((x) => [x.account, x.name, x.debit, x.credit, x.debit - x.credit])] },
        ]} />
      </Hd>
      {Tabs}
      <form className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <input type="hidden" name="t" value="i" />
        <label className="f">Период<select name="p" defaultValue={sp.p ?? 'm'}><option value="m">Месец</option><option value="q">Квартал (3 месеци)</option><option value="r">Од – до</option></select></label>
        <label className="f">Месец<input type="month" name="m" defaultValue={ym} /></label>
        <label className="f">Квартал<select name="q" defaultValue={yq}>{[y - 1, y].flatMap((yy) => [1, 2, 3, 4].map((q) => `${yy}-Q${q}`)).map((v) => <option key={v} value={v}>{v.replace('-Q', ' – ')}. кв.</option>)}</select></label>
        <label className="f">Од<input type="date" name="od" defaultValue={sp.od ?? P.from} /></label>
        <label className="f">До<input type="date" name="do" defaultValue={sp.do ?? P.to} /></label>
        <label className="chk"><input type="checkbox" name="sm" value="1" defaultChecked={onlyMeals} /> само со оброци</label>
        <button className="btn pri">Прикажи</button>
      </form>
      {!L.length && <div className="callout warn" style={{ marginTop: 8 }}>Нема означени оброци во периодот – означете ги во <Link href="/obroci">📋 Дневна листа</Link>.</div>}
      <div id="obrociRep">
        <h2 style={{ margin: '10px 0 4px' }}>{firm.name} – корисници и оброци, {P.label}</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
          <span className="pill">Семејства / лица: <b>{S.tot.served}</b></span>
          <span className="pill">Денови со оброци: <b>{days}</b></span>
          {MEALS.map(([k, n]) => <span key={k} className="pill">{n}: <b>{S.tot[k]}</b></span>)}
          <span className="pill">Оброци: <b>{S.tot.meals}</b></span>
          <span className="pill good">Порции: <b>{S.tot.portions}</b></span>
          <span className="pill warn">Расходи: <b>{fmt(expTot)}</b> ден.</span>
          <span className="pill">Трошок по порција: <b>{fmt(costPerPortion(expTot, S.tot.portions))}</b> ден.</span>
        </div>

        <h3>Регистар на корисници (активни)</h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
          <span className="pill">Семејства / лица: <b>{RS.families}</b></span>
          <span className="pill">Вкупно членови: <b>{RS.members}</b></span>
          <span className="pill">Со телефон: <b>{RS.phone}</b></span>
          <span className="pill">Со ЕМБГ: <b>{RS.embg}</b></span>
          <Link className={'pill' + (RS.consent < RS.families ? ' warn' : ' good')} href="/obroci?t=k&nc=1">Со согласност: <b>{RS.consent}</b> / {RS.families}</Link>
        </div>
        <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {([['Место / населба', RS.byPlace], ['Националност', RS.byNat]] as const).map(([t, G]) => (
            <table key={t} className="dense" style={{ minWidth: 300 }}>
              <thead><tr><th>{t}</th><th className="n">Семејства</th><th className="n">Членови</th></tr></thead>
              <tbody>{G.map((g) => <tr key={g.name}><td>{g.name}</td><td className="n">{g.n}</td><td className="n">{g.members}</td></tr>)}
                {!G.length && <tr><td colSpan={3} className="muted">Регистарот е празен – увезете го во 👪 Корисници.</td></tr>}</tbody>
            </table>
          ))}
        </div>

        <h3>Оброци по корисник</h3>
        <table className="dense">
          <thead><tr><th>Бр.</th><th>Корисник</th><th className="n">Чл.</th><th className="n">Денови</th>{MEALS.map(([k, n]) => <th key={k} className="n">{n}</th>)}<th className="n">Оброци</th><th className="n">Порции</th><th>Потпис</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}><td>{byId.get(r.id)?.no ?? ''}</td><td>{name(r.id)}</td><td className="n">{byId.get(r.id)?.members ?? 1}</td><td className="n">{r.days}</td><td className="n">{r.b}</td><td className="n">{r.l}</td><td className="n">{r.d}</td><td className="n">{r.meals}</td><td className="n">{r.portions}</td><td style={{ minWidth: 110 }} /></tr>
            ))}
            {!rows.length && <tr><td colSpan={10} className="muted">{onlyMeals ? 'Нема евидентирани оброци во периодот.' : 'Нема активни корисници.'}</td></tr>}
          </tbody>
          <tfoot><tr className="tot"><td /><td>Вкупно</td><td /><td className="n">{days}</td><td className="n">{S.tot.b}</td><td className="n">{S.tot.l}</td><td className="n">{S.tot.d}</td><td className="n">{S.tot.meals}</td><td className="n">{S.tot.portions}</td><td /></tr></tfoot>
        </table>

        <h3>Движења во книгите (расходи и приходи)</h3>
        <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <table className="dense" style={{ minWidth: 340 }}>
            <thead><tr><th>Конто</th><th>Расходи</th><th className="n">Износ</th></tr></thead>
            <tbody>{exp.map((x) => <tr key={x.account}><td>{x.account}</td><td>{x.name}</td><td className="n">{fmt(x.debit - x.credit)}</td></tr>)}
              {!exp.length && <tr><td colSpan={3} className="muted">Нема прокнижени расходи во периодот.</td></tr>}</tbody>
            <tfoot><tr className="tot"><td /><td>Вкупно расходи</td><td className="n">{fmt(expTot)}</td></tr></tfoot>
          </table>
          <table className="dense" style={{ minWidth: 340 }}>
            <thead><tr><th>Конто</th><th>Приходи (донации, членарини…)</th><th className="n">Износ</th></tr></thead>
            <tbody>{inc.map((x) => <tr key={x.account}><td>{x.account}</td><td>{x.name}</td><td className="n">{fmt(x.credit - x.debit)}</td></tr>)}
              {!inc.length && <tr><td colSpan={3} className="muted">Нема прокнижени приходи во периодот.</td></tr>}</tbody>
            <tfoot><tr className="tot"><td /><td>Вкупно приходи</td><td className="n">{fmt(incTot)}</td></tr></tfoot>
          </table>
        </div>
        <KitchenReport firm={firm} from={P.from} to={P.to} portions={S.tot.portions} />
        <p className="note">Разлика приходи – расходи: <b>{fmt(incTot - expTot)}</b> ден. Износите се од прокнижените налози (без почетна состојба и затворање). Трошок по порција = вкупни расходи ÷ порции.</p>
      </div>
    </>
  );
}
