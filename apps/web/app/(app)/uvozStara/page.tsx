/**
 * Систем › 📥 Увоз од старата програма — admin uploads legacy backup files; the worker job `legacy.import`
 * (`@wise/legacy-import`) imports them and this page shows progress and the per-firm report.
 */
import Link from 'next/link';
import { desc, eq, inArray } from 'drizzle-orm';
import { can } from '@wise/core';
import { legacyImportRuns, users, type LegacyImportRun } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { Hd, dmyHm } from '@/components/hd';
import { AutoRefresh, ImportForm } from './client';

/** The report shape written by the worker (`ImportReport` of `@wise/legacy-import`). */
interface FirmReport {
  legacyId: string; name: string; firmId: string | null; status: 'created' | 'updated' | 'failed'; source: string; backupAt: string | null;
  legacyCounts: Record<string, number>; counts: Record<string, number>; firmDocs: Record<string, number>;
  skipped: { what: string; reason: string }[]; warnings: string[]; journals: { posted: number; failed: number };
  trialBalance: { ok: boolean; legacy: { debit: number; credit: number }; imported: { debit: number; credit: number }; diffs: { account: string; legacyDebit: number; legacyCredit: number; newDebit: number; newCredit: number }[] };
  files: { imported: number; unavailable: number }; stale: number; error?: string; ms: number;
}
interface Report {
  firms: FirmReport[]; users: { imported: number; updated: number; skipped: { what: string; reason: string }[] } | null;
  settings: string[]; warnings: string[]; parseErrors?: string[];
}

const ST: Record<string, [string, string]> = {
  queued: ['info', 'на ред'], running: ['warn', 'во тек'], done: ['good', 'завршено'], failed: ['bad', 'неуспешно'],
};
const FS: Record<string, [string, string]> = { created: ['good', 'нова'], updated: ['info', 'ажурирана'], failed: ['bad', 'неуспешно'] };
const fmt = (n: number) => n.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const LABEL: Record<string, string> = {
  accounts: 'конта', codes: 'шифрарници', partners: 'комитенти', items: 'артикли', boms: 'нормативи', employees: 'вработени',
  bank_accounts: 'жиро сметки', cash_registers: 'благајни', invoices: 'фактури', 'invoices (proforma)': 'профактури', 'invoices (dispatch)': 'испратници',
  purchases: 'влезни фактури', supplier_credits: 'поврати', cash_vouchers: 'благајнички', compensations: 'компензации', payment_orders: 'налози за плаќање',
  bank_statements: 'изводи', bank_lines: 'ставки од изводи', sales_daily: 'дневни извештаи', payroll_runs: 'плати', production_orders: 'производство',
  levelling_docs: 'нивелации', transfers: 'преносници', stock_counts: 'пописи', stock_moves: 'движења на залиха', fixed_assets: 'основни средства',
  fleet_vehicles: 'возила', journals: 'налози', vat_periods: 'ДДВ периоди', year_closings: 'затворени години', depreciation_runs: 'амортизации',
  firm_docs: 'општи документи', dossier_docs: 'досие', inbox_items: 'пратки', recurring_invoices: 'периодични фактури', service_contracts: 'договори',
  hr_docs: 'HR документи', hotel_rooms: 'хотелски соби', hotel_reservations: 'резервации', appointments: 'термини', construction_projects: 'градежни проекти',
  construction_situations: 'ситуации', construction_diary: 'градежен дневник', travel_arrangements: 'аранжмани', travel_bookings: 'резервации (тури)',
  rent_rentals: 'изнајмувања', freight_tours: 'тури (превоз)',
};

function FirmRow({ r }: { r: FirmReport }) {
  const [cls, lbl] = FS[r.status] ?? ['', r.status];
  const counts = Object.entries(r.counts).filter(([, n]) => n).map(([k, n]) => `${LABEL[k] ?? k}: ${n}`).join(' · ');
  return (
    <details className="card" style={{ padding: '8px 12px' }}>
      <summary style={{ cursor: 'pointer' }}>
        <b>{r.name}</b> <span className={`pill ${cls}`}>{lbl}</span>{' '}
        {r.status !== 'failed' && (r.trialBalance.ok
          ? <span className="pill good">бруто биланс ✓</span>
          : <span className="pill bad">бруто биланс: {r.trialBalance.diffs.length} разлики</span>)}{' '}
        <span className="mini">налози {r.journals.posted}{r.journals.failed ? ` · неуспешни ${r.journals.failed}` : ''} · прескокнати {r.skipped.length}{r.firmId ? '' : ''}</span>
        {r.firmId && <> · <Link href={`/firmi?edit=${r.firmId}`} className="mini">фирма</Link></>}
      </summary>
      {r.error && <div className="callout bad">{r.error}</div>}
      <p className="note">Извор: {r.source}{r.backupAt ? ` · копија од ${r.backupAt.slice(0, 10)}` : ''} · {Math.round(r.ms / 100) / 10} s</p>
      {counts && <p className="note">Увезено – {counts}</p>}
      {Object.keys(r.firmDocs).length > 0 && (
        <p className="note">Зачувано како општи документи (табела за нив сè уште нема): {Object.entries(r.firmDocs).map(([k, n]) => `${k}: ${n}`).join(' · ')}</p>
      )}
      {r.status !== 'failed' && (
        <p className="note">
          Бруто биланс (промет): стара програма Д {fmt(r.trialBalance.legacy.debit)} / П {fmt(r.trialBalance.legacy.credit)} · увезено Д {fmt(r.trialBalance.imported.debit)} / П {fmt(r.trialBalance.imported.credit)}
        </p>
      )}
      {r.trialBalance.diffs.length > 0 && (
        <div className="tw"><table className="dense"><thead><tr><th>Конто</th><th className="n">Стара Д</th><th className="n">Стара П</th><th className="n">Нова Д</th><th className="n">Нова П</th></tr></thead><tbody>
          {r.trialBalance.diffs.map((d) => <tr key={d.account}><td>{d.account}</td><td className="n">{fmt(d.legacyDebit)}</td><td className="n">{fmt(d.legacyCredit)}</td><td className="n">{fmt(d.newDebit)}</td><td className="n">{fmt(d.newCredit)}</td></tr>)}
        </tbody></table></div>
      )}
      {r.skipped.length > 0 && (
        <div className="tw" style={{ maxHeight: 260 }}><table className="dense"><thead><tr><th>Прескокнато</th><th>Причина</th></tr></thead><tbody>
          {r.skipped.map((s, i) => <tr key={i}><td>{s.what}</td><td>{s.reason}</td></tr>)}
        </tbody></table></div>
      )}
      {r.warnings.length > 0 && <ul className="note">{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {r.stale > 0 && <p className="note">{r.stale} записи увезени претходно ги нема во оваа копија – оставени се непроменети.</p>}
    </details>
  );
}

function RunView({ run }: { run: LegacyImportRun }) {
  const [cls, lbl] = ST[run.status] ?? ['', run.status];
  const rep = run.report as unknown as Report | null;
  const p = run.progress;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="card">
      <h2>Увоз од {dmyHm(run.createdAt)} <span className={`pill ${cls}`}>{lbl}</span></h2>
      <p className="note">Датотеки: {run.files.map((f) => f.name).join(', ')}</p>
      {(run.status === 'running' || run.status === 'queued') && (
        <>
          <div style={{ background: 'var(--line, #ddd)', borderRadius: 4, height: 10, margin: '6px 0' }}>
            <div style={{ width: `${pct}%`, background: 'var(--info, #2a6fdb)', height: 10, borderRadius: 4 }} />
          </div>
          <p className="note">{run.status === 'queued' ? 'Чека на ред…' : `Фирма ${Math.min(p.done + 1, p.total)} од ${p.total}${p.firm ? ` – ${p.firm}` : ''}${p.step ? ` · ${p.step}` : ''}`}</p>
        </>
      )}
      {run.error && <div className="callout bad">Увозот не успеа: {run.error}</div>}
      {rep && (
        <>
          {(rep.parseErrors ?? []).length > 0 && <div className="callout bad">{rep.parseErrors!.map((e, i) => <div key={i}>{e}</div>)}</div>}
          <p>
            <b>{rep.firms.length}</b> фирми · нови {rep.firms.filter((f) => f.status === 'created').length} · ажурирани {rep.firms.filter((f) => f.status === 'updated').length}
            {' '}· неуспешни {rep.firms.filter((f) => f.status === 'failed').length} · бруто биланс без разлики {rep.firms.filter((f) => f.status !== 'failed' && f.trialBalance.ok).length}
          </p>
          {rep.users && <p className="note">Корисници: нови {rep.users.imported}, ажурирани {rep.users.updated}{rep.users.skipped.length ? `, прескокнати: ${rep.users.skipped.map((s) => `${s.what} (${s.reason})`).join('; ')}` : ''}</p>}
          {rep.settings.length > 0 && <ul className="note">{rep.settings.map((s, i) => <li key={i}>{s}</li>)}</ul>}
          {rep.warnings.length > 0 && <details className="note"><summary>Забелешки при читање ({rep.warnings.length})</summary><ul>{rep.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          {rep.firms.map((r) => <FirmRow key={r.legacyId} r={r} />)}
        </>
      )}
    </div>
  );
}

export default async function UvozStaraPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const sp = await searchParams;
  const me = await requireUser();
  if (!can(me.principal, 'users')) {
    return <><Hd t="📥 Увоз од старата програма" /><div className="callout warn">Увозот од старата програма е дозволен само за администратор.</div></>;
  }
  const runs = await db().select().from(legacyImportRuns).orderBy(desc(legacyImportRuns.createdAt)).limit(20);
  const sel = (sp.run && /^[0-9a-f-]{36}$/.test(sp.run) ? runs.find((r) => r.id === sp.run) ?? (await db().select().from(legacyImportRuns).where(eq(legacyImportRuns.id, sp.run)).limit(1))[0] : runs[0]) ?? null;
  const by = runs.length ? await db().select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, runs.map((r) => r.createdBy).filter((x): x is string => !!x))) : [];
  const active = !!sel && (sel.status === 'queued' || sel.status === 'running');

  return (
    <>
      <Hd t="📥 Увоз од старата програма" sub="фирми, документи, налози, плати, залиха од резервна копија" />
      <AutoRefresh active={active} />
      <div className="callout">
        <b>Како да ја направите копијата во старата програма:</b> Систем › „Податоци и резервна копија“ → „💾 Направи копија сега (сите фирми)“ →
        „⬇ Последната копија (ZIP)“. За лого, потпис и печат на фирма: отворете ја фирмата и кликнете „⬇ Само оваа фирма (JSON)“.
        Увозот може да се повтори – истата фирма се ажурира, не се дуплира.
      </div>
      <ImportForm />
      {sel && <RunView run={sel} />}
      {runs.length > 1 && (
        <div className="card"><h2>Претходни увози</h2><div className="tw"><table className="dense">
          <thead><tr><th>Време</th><th>Статус</th><th>Датотеки</th><th className="n">Фирми</th><th>Започнал</th></tr></thead>
          <tbody>{runs.map((r) => {
            const [c, l] = ST[r.status] ?? ['', r.status];
            return (
              <tr key={r.id}>
                <td><Link href={`/uvozStara?run=${r.id}`}>{dmyHm(r.createdAt)}</Link></td>
                <td><span className={`pill ${c}`}>{l}</span></td>
                <td>{r.files.map((f) => f.name).join(', ')}</td>
                <td className="n">{r.progress.total}</td>
                <td>{by.find((u) => u.id === r.createdBy)?.name ?? '—'}</td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      )}
    </>
  );
}
