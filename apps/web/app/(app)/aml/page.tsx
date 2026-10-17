/**
 * Legacy `VIEWS.aml` **15976** — AML (ЗСППФТ): only the owner and the AML officer see the module (`amlOn`); everyone
 * else gets the internal suspicion report form. Legacy tabs 👥 Клиенти, 🏢 Канцеларија, 🚩 Пријави; server additions
 * (docs/legal/AML-UFR.md): 📋 Задачи (open AML tasks per firm), 📡 Мониторинг (alerts from the books + documented
 * decision), 📤 УФР reports with deadlines and submission, 📚 Регистри, 📘 Процедури.
 */
import { desc } from 'drizzle-orm';
import { AML_LAW } from '@wise/core/office';
import { AUTO_META } from '@wise/core/office/automations';
import { amlPurgeList, amlRecords, amlReports, autoLastRun, users } from '@wise/db';
import { amlAllowed, amlOffice } from '@/lib/aml';
import { db } from '@/lib/db';
import { allowedFirms, officePage, today } from '@/lib/office';
import { AutoStatus } from '@/components/auto-status';
import { Hd } from '@/components/hd';
import { ReportForm } from './report-form';
import { TabTasks } from './tab-tasks';
import { TabClient } from './tab-client';
import { TabMonitor } from './tab-monitor';
import { TabReports } from './tab-reports';
import { TabRegisters } from './tab-registers';
import { TabOffice } from './tab-office';
import { TabProc } from './tab-proc';

const TABS = [['zad', '📋 Задачи'], ['cl', '👥 Клиенти (CDD)'], ['mon', '📡 Мониторинг'], ['rep', '🚩 Пријави и УФР'], ['reg', '📚 Регистри'], ['off', '🏢 Канцеларија'], ['proc', '📘 Процедури']] as const;
type Tab = (typeof TABS)[number][0];

export default async function AmlPage({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await officePage('aml', { perm: 'write' });
  const td = today();
  const F0 = await allowedFirms(u, { year: 'all' });
  const clientsF = F0.filter((f) => !(f.settings as { officeFirm?: boolean }).officeFirm);
  if (!(await amlAllowed(u))) {
    return (
      <>
        <Hd t="🚩 Пријави сомневање (УФР)" sub="внатрешна пријава до овластеното лице" exp={false} />
        <div className="callout bad"><b>Законска обврска:</b> ако забележите сомнителна трансакција или однесување кај клиент, веднаш пријавете го овде. Пријавата ја гледаат <b>само</b> управителот и овластеното лице. <b>Не го известувајте клиентот</b> ниту други лица (забрана за откривање, чл. 72).</div>
        <ReportForm firms={clientsF} />
        <TabProc short />
      </>
    );
  }
  const tab: Tab = (TABS.map(([k]) => k) as readonly string[]).includes(sp.tab ?? '') ? sp.tab as Tab : 'zad';
  const [R, O, reps, U, last, purge] = await Promise.all([db().select().from(amlRecords), amlOffice(),
    db().select().from(amlReports).orderBy(desc(amlReports.createdAt)), db().select({ id: users.id, name: users.name, role: users.role, active: users.active }).from(users),
    autoLastRun(db(), 'aml').catch(() => null), amlPurgeList(db(), td)]);
  const nPurge = purge.clients.length + purge.reports.length;
  return (
    <>
      <Hd t="🛡 Спречување перење пари и финансирање тероризам" sub="УФР · ЗСППФТ (151/2022, 208/2024)" />
      <p className="mini" style={{ margin: '0 0 6px' }}>{AML_LAW}. Податоците во овој модул ги гледаат само сопственикот и овластеното лице и се чуваат 10 години (чл. 62).</p>
      {/* P43: the weekly monitoring and the retention list (prepared only — deleting stays the owner's „Избриши“ in Регистри) */}
      {(last || nPurge > 0) && (
        <p className="row noprint" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 8px' }}>
          {last && <AutoStatus label="Проверено автоматски" at={last.at} when={AUTO_META.aml.when} />}
          {nPurge > 0 && <a className="pill warn" href="/aml?tab=reg" title="Рокот за чување (10 години, чл. 62) е истечен – записите се бришат само рачно, од сопственикот">🗑 За бришење (истечен рок): {nPurge}</a>}
        </p>
      )}
      <div className="row noprint" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {TABS.map(([k, n]) => <a key={k} className={`btn ${tab === k ? 'pri' : ''}`} href={`/aml?tab=${k}`}>{n}</a>)}
      </div>
      {tab === 'zad' && <TabTasks clients={clientsF} records={R} reports={reps} office={O} today={td} firmId={firm?.id ?? null} />}
      {tab === 'cl' && <TabClient firm={firm && clientsF.some((c) => c.id === firm.id) ? firm : null} clients={clientsF} records={R} today={td} admin={u.role === 'admin'} />}
      {tab === 'mon' && <TabMonitor clients={clientsF} reports={reps} today={td} />}
      {tab === 'rep' && <TabReports clients={clientsF} reports={reps} today={td} admin={u.role === 'admin'} openId={sp.id ?? null} />}
      {tab === 'reg' && <TabRegisters clients={clientsF} records={R} reports={reps} office={O} today={td} admin={u.role === 'admin'} />}
      {tab === 'off' && <TabOffice office={O} users={U} today={td} admin={u.role === 'admin'} records={R} />}
      {tab === 'proc' && <TabProc />}
    </>
  );
}
