/**
 * Legacy `VIEWS.zatvoranje` (8713) — Месечно затворање (сите фирми): per firm, for the chosen month, which tasks are
 * done (statements, purchases, invoices without number gaps, cash balance, payroll, VAT return, month locked),
 * grouped by priority; „🔒 Заклучи“ locks the books to the month end. The facts are gathered with a few aggregated
 * queries for all firms (legacy loaded each firm's data in the browser).
 */
import Link from 'next/link';
import { and, eq, inArray, like, ne, sql } from 'drizzle-orm';
import { can } from '@wise/core';
import { ymAdd, zatMonthEnd, zatPrio, zatTasks, type ZatFacts, type ZatTask } from '@wise/core/firms/zatvoranje';
import { bankStatements, employees, invoices, journalLines, journals, payrollRuns, purchases, vatPeriods } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, officePage, today } from '@/lib/office';
import { Hd, dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { lockMonth } from './actions';

const cell = (t: ZatTask) => (t.ok === null ? <span className="mini" style={{ color: 'var(--muted)' }}>—</span> : t.ok ? <span className="pill good">✓</span> : <span className="pill bad">✗</span>);

export default async function ZatvoranjePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { u } = await officePage('zatvoranje');
  const sp = await searchParams;
  const td = today();
  const ym = sp.m && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : ymAdd(td.slice(0, 7), -1);
  const ms = ym + '-01', me = zatMonthEnd(ym), y0 = ym.slice(0, 4) + '-01-01';
  const F = await allowedFirms(u);
  const ids = F.map((f) => f.id);
  const inM = (col: Parameters<typeof sql>[1]) => sql`${col} between ${ms} and ${me}`;
  const none = !ids.length;
  const [ST, PU, IN, NO, CA, EM, PR, VP] = none ? [[], [], [], [], [], [], [], []] : await Promise.all([
    db().select({ f: bankStatements.firmId, n: sql<number>`count(*)::int` }).from(bankStatements).where(and(inArray(bankStatements.firmId, ids), inM(bankStatements.date))).groupBy(bankStatements.firmId),
    db().select({ f: purchases.firmId, n: sql<number>`count(*)::int` }).from(purchases).where(and(inArray(purchases.firmId, ids), ne(purchases.status, 'draft'), inM(purchases.date))).groupBy(purchases.firmId),
    db().select({ f: invoices.firmId, n: sql<number>`count(*)::int` }).from(invoices).where(and(inArray(invoices.firmId, ids), eq(invoices.kind, 'invoice'), ne(invoices.status, 'draft'), inM(invoices.date))).groupBy(invoices.firmId),
    db().select({ f: invoices.firmId, no: invoices.number }).from(invoices).where(and(inArray(invoices.firmId, ids), eq(invoices.kind, 'invoice'), eq(invoices.advance, false), ne(invoices.status, 'draft'), sql`${invoices.date} between ${y0} and ${me}`)),
    db().select({ f: journalLines.firmId, b: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})` }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
      .where(and(inArray(journalLines.firmId, ids), eq(journalLines.account, '1020'), sql`${journals.date} between ${y0} and ${me}`)).groupBy(journalLines.firmId),
    db().select({ f: employees.firmId, n: sql<number>`count(*)::int` }).from(employees)
      .where(and(inArray(employees.firmId, ids), eq(employees.active, true), sql`(${employees.start} is null or ${employees.start} <= ${me}) and (${employees.end} is null or ${employees.end} >= ${ms})`)).groupBy(employees.firmId),
    db().select({ f: payrollRuns.firmId, locked: payrollRuns.locked }).from(payrollRuns).where(and(inArray(payrollRuns.firmId, ids), eq(payrollRuns.month, ym))),
    db().select({ f: vatPeriods.firmId, p: vatPeriods.period }).from(vatPeriods).where(and(inArray(vatPeriods.firmId, ids), eq(vatPeriods.status, 'closed'), like(vatPeriods.period, ym.slice(0, 4) + '%'))),
  ]);
  const cnt = (L: { f: string; n: number }[]) => new Map(L.map((r) => [r.f, r.n]));
  const st = cnt(ST), pu = cnt(PU), inv = cnt(IN), em = cnt(EM);
  const nos = new Map<string, string[]>(); for (const r of NO) nos.set(r.f, [...(nos.get(r.f) ?? []), r.no]);
  const ca = new Map(CA.map((r) => [r.f, Number(r.b) || 0]));
  const pr = new Map(PR.map((r) => [r.f, { exists: true, locked: r.locked }]));
  const vp = new Map<string, Set<string>>(); for (const r of VP) vp.set(r.f, (vp.get(r.f) ?? new Set()).add(r.p));
  const rows = F.map((f) => {
    const facts: ZatFacts = {
      vat: f.vatRegistered, vatPeriod: f.vatPeriod, lockDate: f.lockDate, statements: st.get(f.id) ?? 0, invoices: inv.get(f.id) ?? 0,
      purchases: pu.get(f.id) ?? 0, invoiceNumbers: nos.get(f.id) ?? [], cash: { any: ca.has(f.id), balance: Math.round((ca.get(f.id) ?? 0) * 100) / 100 },
      activeEmployees: em.get(f.id) ?? 0, payrollRun: pr.get(f.id) ?? null, vatClosed: vp.get(f.id) ?? new Set(),
    };
    const T = zatTasks(facts, ym);
    const [p, pl] = zatPrio(facts, ym);
    return { f, T, p, pl, bad: T.filter((t) => t.ok === false).length };
  }).sort((a, b) => a.p - b.p || b.bad - a.bad);
  const groups = [...new Set(rows.map((r) => r.pl))];
  const tot = rows.reduce((a, r) => { const A = r.T.filter((t) => t.ok !== null); a.n += A.length; a.ok += A.filter((t) => t.ok).length; return a; }, { n: 0, ok: 0 });
  const months = Array.from({ length: 15 }, (_, i) => ymAdd(td.slice(0, 7), -i));
  return (
    <>
      <Hd t="Месечно затворање – сите фирми" sub={`${ym.slice(5)}/${ym.slice(0, 4)} · завршено ${tot.ok}/${tot.n} задачи`}>
        <form className="row" style={{ gap: 6 }}>
          <select name="m" defaultValue={ym} style={{ width: 'auto' }}>{months.map((m) => <option key={m} value={m}>{m.slice(5)}/{m.slice(0, 4)}</option>)}</select>
          <button className="btn">↻ Провери</button>
        </form>
      </Hd>
      <p className="note">Редослед: прво ДДВ обврзниците (месечни, па тромесечни – рок ДДВ-04: 25-ти во наредниот месец), потоа фирмите без ДДВ со вработени (плата и МПИН), па останатите. ✓ = завршено · ✗ = треба да се заврши · — = не важи за фирмата.</p>
      {groups.map((g) => (
        <div key={g}>
          <h3 style={{ margin: '14px 0 6px', fontSize: 15 }}>{g}</h3>
          <div className="tw"><table className="dense">
            <thead><tr><th>Фирма</th><th className="n">Готово</th><th>Задачи</th><th style={{ width: 170 }}></th></tr></thead>
            <tbody>
              {rows.filter((r) => r.pl === g).map((r) => {
                const A = r.T.filter((t) => t.ok !== null), ok = A.filter((t) => t.ok).length, pct = A.length ? Math.round(ok / A.length * 100) : 100;
                const due = r.T.filter((t) => t.due && t.ok === false).map((t) => t.due!).sort()[0];
                const open = r.T.filter((t) => t.ok === false && t.k !== 'lock');
                const locked = r.T.find((t) => t.k === 'lock')?.ok;
                return (
                  <tr key={r.f.id}>
                    <td><b>{r.f.name}</b>{due && <div className="mini" style={{ color: due < td ? 'var(--bad)' : 'var(--muted)' }}>рок: {dmy(due)}{due < td ? ' – ПОМИНАТ' : ''}</div>}</td>
                    <td className="n"><div style={{ minWidth: 90 }}><b>{ok}/{A.length}</b><div style={{ height: 6, background: 'var(--line)', borderRadius: 3, marginTop: 3 }}><div style={{ height: 6, width: pct + '%', background: pct === 100 ? '#1f8a4c' : pct >= 50 ? '#e08a00' : '#d11a2a', borderRadius: 3 }} /></div></div></td>
                    <td><div className="row" style={{ gap: '6px 12px', flexWrap: 'wrap' }}>
                      {r.T.map((t) => (
                        <span key={t.k} title={t.info}>{cell(t)} {t.n}<span className="mini" style={{ display: 'block', color: 'var(--muted)', maxWidth: 210 }}>{t.info}{t.due && t.ok === false ? ' · рок ' + dmy(t.due) : ''}</span></span>
                      ))}
                    </div></td>
                    <td style={{ textAlign: 'right' }}>
                      {locked ? <span className="pill good">🔒 заклучен</span>
                        : can(u.principal, 'fix', r.f.id) && <RowAction className="btn sm pri" action={lockMonth.bind(null, r.f.id, ym)} label={`🔒 Заклучи ${ym.slice(5)}/${ym.slice(0, 4)}`}
                          confirm={`Да се заклучи ${r.f.name} до ${dmy(me)}?${open.length ? '\n\nНЕЗАВРШЕНИ задачи:\n• ' + open.map((t) => t.n + ': ' + t.info).join('\n• ') + '\n\nПо заклучувањето не може да се внесуваат/менуваат документи за тој период.' : ''}`} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      ))}
      {!rows.length && <div className="card empty">Нема фирми.</div>}
      <p className="note">„🔒 Заклучи“ го заклучува периодот до крајот на месецот: потоа ништо не може да се внесе, смени или избрише за тој период (освен ако повторно се отклучи во <Link href="/firmi">Фирми</Link>). Задачите се отвораат во фирмата: изберете ја со „⇄ Промени фирма“.</p>
    </>
  );
}
