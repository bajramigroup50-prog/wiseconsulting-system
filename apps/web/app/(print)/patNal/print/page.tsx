/**
 * ✈️ Prints of a патен налог: `f=nalog` — ПАТЕН НАЛОГ (order: employee, destination, purpose, vehicle, dates, advance,
 * approval), `f=presmetka` — ПРЕСМЕТКА НА ПАТНИ ТРОШОЦИ (per diems per country, own car, costs, advance → to pay /
 * return, signatures with the firm stamp).
 */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { BT_COST_KINDS, BT_REDUCTIONS, BT_VEHICLES, btCountryName, btSettle } from '@wise/core/btrip';
import { invoicePrintImg } from '@wise/core/sales';
import { btripJournals, btripSettings, employees, getBtrip } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { fxLookup } from '@/lib/fuel';
import { DocHead } from '@/components/industry-print';

const hm = (d: string) => (d ? dmy(d.slice(0, 10)) + ' во ' + d.slice(11, 16) + ' ч.' : '');

export default async function PatNalPrint({ searchParams }: { searchParams: Promise<{ id?: string; f?: string }> }) {
  const sp = await searchParams;
  const { firm } = await booksPage('patNal');
  if (!firm) notFound();
  const row = sp.id ? await getBtrip(db(), firm.id, sp.id) : null;
  if (!row) notFound();
  const t = row.data;
  const [[e], cfg, fx, J] = await Promise.all([
    db().select().from(employees).where(eq(employees.id, t.employeeId)).limit(1),
    btripSettings(db(), firm.id), fxLookup(firm.id), btripJournals(db(), firm.id),
  ]);
  const S = cfg.s;
  const st = btSettle(t, S, fx);
  const stamp = String(((firm.settings ?? {}) as Record<string, unknown>).stamp ?? '').trim();
  const where = `${t.dest}${t.abroad && t.country ? ', ' + btCountryName(t.country) : ''}`;
  const veh = BT_VEHICLES.find((v) => v[0] === t.vehicle)?.[1] ?? '';
  const sig = (L: string[]) => (
    <div style={{ marginTop: 34, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
      {L.map((x, i) => <span key={x}>{i === L.length - 1 && stamp && <img src={invoicePrintImg(stamp)} alt="" style={{ maxHeight: 55, display: 'block' }} />}{x}: ______________</span>)}
    </div>
  );
  const kv = (k: string, v: React.ReactNode) => <tr><td style={{ width: '38%' }}>{k}</td><td><b>{v}</b></td></tr>;

  if (sp.f !== 'presmetka') {
    return (
      <>
        <DocHead firm={firm} title={`ПАТЕН НАЛОГ бр. ${row.number}`} sub={`за службено патување ${t.abroad ? 'во странство' : 'во земјата'} · ${dmy(t.date)}`} />
        <p>Се упатува на службено патување:</p>
        <table className="dense" style={{ width: '100%' }}><tbody>
          {kv('Име и презиме', e?.name ?? '')}
          {kv('Работно место', e?.position ?? '')}
          {kv('ЕМБГ', e?.embg ?? '')}
          {kv('Место (дестинација)', where)}
          {kv('Цел на патувањето', t.purpose)}
          {kv('Поаѓање', hm(t.dep))}
          {kv('Враќање (предвидено)', hm(t.ret))}
          {kv('Превоз', [veh, t.plate].filter(Boolean).join(' · '))}
          {kv('Аконтација', t.advance ? `${fmt(t.advance)} ${t.advCur || 'MKD'}${t.advDate ? ' (исплатена ' + dmy(t.advDate) + ')' : ''}` : 'нема')}
          {kv('Трошоците паѓаат на товар на', firm.name)}
        </tbody></table>
        <p className="note" style={{ fontSize: 9 }}>По враќањето, во рок од 3 дена, патниот налог со пресметката и сметките (за превоз, сместување и др.) се доставува за ликвидација; неискористената аконтација се враќа.</p>
        {t.report && <><h4>Извештај од патувањето</h4><p style={{ whiteSpace: 'pre-wrap' }}>{t.report}</p></>}
        {sig(['Патувал', `Налогодавач${t.approver ? ' (' + t.approver + ')' : ''}`])}
      </>
    );
  }
  return (
    <>
      <DocHead firm={firm} title={`ПРЕСМЕТКА НА ПАТНИ ТРОШОЦИ кон патен налог бр. ${row.number}`} sub={`${e?.name ?? ''} · ${where} · ${hm(t.dep)} – ${hm(t.ret)}${J.get(row.id) ? ' · книжено во налог ' + J.get(row.id) : ''}`} />
      <h4 style={{ margin: '8px 0 4px' }}>1. Дневници ({st.hrs} ч. вкупно)</h4>
      <table className="dense" style={{ width: '100%' }}><thead><tr><th>Држава</th><th>Од</th><th>До</th><th className="n">Часови</th><th className="n">Број</th><th className="n">Дневница</th><th className="n">Износ</th><th className="n">Курс</th><th className="n">Денари</th></tr></thead>
        <tbody>{st.rows.map((r, i) => (
          <tr key={i}><td>{btCountryName(r.c)}</td><td>{r.in.replace('T', ' ')}</td><td>{r.out.replace('T', ' ')}</td><td className="n">{r.hrs ?? ''}</td><td className="n">{r.u}</td><td className="n">{fmt(r.amt)} {r.cur}</td><td className="n">{fmt(r.v)} {r.cur}</td><td className="n">{r.cur === 'MKD' ? '' : r.fx}</td><td className="n">{fmt(r.m)}</td></tr>))}</tbody>
        <tfoot><tr><th colSpan={8}>{Number(t.red ?? 100) < 100 ? 'Намалување: ' + (BT_REDUCTIONS.find((x) => x[0] === Number(t.red))?.[1] ?? `${t.red}%`) : 'Вкупно дневници'}</th><th className="n">{fmt(st.perDiem)}</th></tr></tfoot></table>
      <h4 style={{ margin: '10px 0 4px' }}>2. Превоз, сместување и други трошоци</h4>
      <table className="dense" style={{ width: '100%' }}><thead><tr><th>Вид</th><th>Опис / документ</th><th className="n">Износ</th><th className="n">Курс</th><th className="n">Денари</th></tr></thead>
        <tbody>
          {st.car > 0 && <tr><td>Сопствено возило</td><td>{t.plate} · {t.km} км × {fmt(S.fuelPrice)} ден./л × {S.carPct}%</td><td className="n" /><td className="n" /><td className="n">{fmt(st.car)}</td></tr>}
          {st.costs.map((c, i) => <tr key={i}><td>{BT_COST_KINDS.find((k) => k[0] === c.k)?.[1].split(' (')[0]}</td><td>{c.d}</td><td className="n">{fmt(c.amt)} {c.cur}</td><td className="n">{c.cur === 'MKD' ? '' : c.fx}</td><td className="n">{fmt(c.m)}</td></tr>)}
          {!st.car && !st.costs.length && <tr><td colSpan={5} className="note">нема</td></tr>}
        </tbody>
        <tfoot><tr><th colSpan={4}>Вкупно</th><th className="n">{fmt(st.car + st.transport + st.lodging + st.other)}</th></tr></tfoot></table>
      <table className="dense" style={{ width: '60%', marginTop: 12, marginLeft: 'auto' }}><tbody>
        <tr><td>Вкупно патни трошоци</td><td className="n"><b>{fmt(st.total)}</b></td></tr>
        <tr><td>Примена аконтација</td><td className="n">{fmt(st.advance)}</td></tr>
        <tr><th>{st.toReturn > 0 ? 'За враќање од вработениот' : 'За исплата на вработениот'}</th><th className="n">{fmt(st.toReturn > 0 ? st.toReturn : st.toPay)} ден.</th></tr>
      </tbody></table>
      <p className="note" style={{ fontSize: 9 }}>Дневниците се пресметани {t.abroad ? 'според Уредбата за издатоците за службени патувања и селидби во странство (од премин на државната граница; курс: среден курс на НБРМ)' : 'по дневницата во земјата'}: полни 24 ч = 1 дневница, остаток над 12 ч = 1, од 8 до 12 ч = ½. Прилог: сметки за трошоците.</p>
      {sig(['Пресметал', 'Патувал', 'Одобрил'])}
    </>
  );
}
