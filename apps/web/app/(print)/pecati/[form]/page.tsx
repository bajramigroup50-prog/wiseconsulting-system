/**
 * Year-end print forms: `/pecati/bs-prav`, `bu-prav` (prescribed form), `bs-crm`, `bu-crm` (ЦРМ layout), `db`, `vp`,
 * `bel`, `tp` (Образец Б + ДЛД-ДБ), `npo`, `os` (fixed-asset register). Same guards as the screens.
 */
import { notFound } from 'next/navigation';
import { npoDbRows } from '@wise/core/yearend/books';
import { eq } from 'drizzle-orm';
import { appSettings, depreciationFor } from '@wise/db';
import { db } from '@/lib/db';
import { fmt, dmy } from '@/lib/fmt';
import { yePage } from '@/lib/yearend';
import { BelPrint, CrmForm, DbForm, OffForm, VpForm, type Signers } from '@/components/yearend/print-forms';
import { NpoTables, TpTables } from '@/components/yearend/entity-tables';

const VIEW: Record<string, string> = {
  'bs-prav': 'zs_bs', 'bu-prav': 'zs_bu', 'bs-crm': 'zs_bs', 'bu-crm': 'zs_bu', db: 'zs_db', vp: 'zs_vp', bel: 'zsBel', tp: 'zsTP', npo: 'zsNPO', os: 'os',
};
const GUARD: Record<string, string> = { tp: 'zsTP', npo: 'zsNPO', os: 'os' };

export default async function PrintPage({ params }: { params: Promise<{ form: string }> }) {
  const { form } = await params;
  const view = VIEW[form];
  if (!view) notFound();
  const c = await yePage(view, GUARD[form] ?? 'zsProc');
  if (!c) return <p>Изберете фирма.</p>;
  const { L, firm, year, u } = c;
  const [off] = await db().select().from(appSettings).where(eq(appSettings.key, 'office')).limit(1);
  const O = (off?.value ?? {}) as Record<string, string | undefined>;
  const fs = (firm.settings ?? {}) as Record<string, string | undefined>;
  const sig: Signers = {
    rep: O.rep || u.name, office: O.name || '', lic: O.lic || fs.accReg || '', officeEdb: O.edb || '', signer: fs.signer || '', signerRole: fs.signerRole || 'Управител',
  };
  const cur = L.Y.co.zs.V, prev = L.prev.V;
  switch (form) {
    case 'bs-prav': case 'bu-prav':
      return <OffForm rep={form.slice(0, 2) as 'bs' | 'bu'} rules={L.rules} cur={cur} prev={prev} firm={firm} year={year} sig={sig} />;
    case 'bs-crm': case 'bu-crm':
      return <CrmForm rep={form.slice(0, 2) as 'bs' | 'bu'} rules={L.rules} cur={cur} prev={prev} firm={firm} year={year} sig={sig} />;
    case 'db': return <DbForm D={L.Y.co.db} firm={firm} year={year} sig={sig} />;
    case 'vp': return <VpForm D={L.Y.vp} firm={firm} year={year} sig={sig} />;
    case 'bel': return <BelPrint firm={firm} year={year} cur={cur} prev={prev} notes={L.statement?.notes} prevNotes={L.prevStatement?.notes} sig={sig} />;
    case 'tp': return L.Y.tp ? <TpTables T={L.Y.tp} firm={firm} year={year} print /> : notFound();
    case 'npo': return L.Y.npo ? <NpoTables N={L.Y.npo} firm={firm} year={year} print dbRows={npoDbRows(L.Y.co.balances.pre, L.Y.npoChart !== 'npo')} /> : notFound();
    case 'os': {
      const d = await depreciationFor(db(), firm.id, year);
      const by = new Map(d.rows.map((r) => [r.id, r]));
      return (
        <div>
          <div className="ph"><div><div className="pt">РЕГИСТАР НА ОСНОВНИ СРЕДСТВА</div><div className="ps">амортизација за {year}</div></div><div className="pm">{firm.name}</div></div>
          <table><thead><tr><th>Инв. бр.</th><th>Назив</th><th>Конто</th><th>Датум</th><th className="n">Стапка</th><th className="n">Набавна вредност</th><th className="n">Амортизација {year}</th><th className="n">Отпис вкупно</th><th className="n">Сегашна вредност</th></tr></thead>
            <tbody>{d.assets.map((a) => { const r = by.get(a.id); return (
              <tr key={a.id}><td>{a.invNo}</td><td>{a.name}{a.vehicleOnly ? ' (само евиденција)' : ''}{a.disposed ? ` – отпишано ${dmy(a.disposed)}` : ''}</td><td>{a.konto}</td><td>{dmy(a.date)}</td><td className="n">{Number(a.rate)}%</td>
                <td className="n">{fmt(a.cost)}</td><td className="n">{fmt(r?.year ?? 0)}</td><td className="n">{fmt(r?.acc ?? 0)}</td><td className="n">{fmt(Number(a.cost) - (r?.acc ?? 0))}</td></tr>); })}</tbody>
            <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fmt(d.assets.reduce((s, a) => s + Number(a.cost), 0))}</td><td className="n">{fmt(d.total)}</td><td className="n">{fmt(d.rows.reduce((s, r) => s + r.acc, 0))}</td><td /></tr></tfoot>
          </table>
        </div>
      );
    }
  }
  notFound();
}
