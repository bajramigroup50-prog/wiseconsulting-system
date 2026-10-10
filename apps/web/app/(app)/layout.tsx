import { eq, sql } from 'drizzle-orm';
import { can } from '@wise/core';
import { journals } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm, currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { navFor } from '@/lib/nav';
import { filterNavByModules } from '@/lib/nav-industry';
import { klNav } from '@/lib/kl-nav';
import { topStatus } from '@/lib/top-status';
import { AinbPanel } from '@/components/ainb';
import { AlStartup } from '@/components/al-startup';
import { Nav } from '@/components/nav';
import { NavBack } from '@/components/nav-back';
import { TopBar } from '@/components/top-bar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const [firm, year] = await Promise.all([currentFirm(u), currentYear()]);
  // Phase 10: views of industry modules that are off for the firm are hidden (FIX LEGACY-MAP 10.4 item 9).
  // klient: legacy `klNav` — the sections the office switched on for this firm
  const groups = u.role === 'klient' ? await klNav(firm) : filterNavByModules(navFor(u.role), firm, false);
  const office = u.role !== 'klient' && u.role !== 'teren';
  const [st, [y0]] = await Promise.all([
    topStatus(u).catch(() => ({ bell: null, ainb: [], law: null })),
    // legacy `dataYears()`: the year list starts at the firm's first booked year
    firm ? db().select({ y: sql<number | null>`min(extract(year from ${journals.date}))::int` }).from(journals).where(eq(journals.firmId, firm.id)).catch(() => [{ y: null }]) : Promise.resolve([{ y: null }]),
  ]);
  return (
    <div className="app">
      <header className="mbar">
        <div className="brand" title="WISE CONSULTING"><i aria-hidden="true">W</i><span>WISE CONSULTING</span></div>
        <Nav groups={groups} />
      </header>
      <main>
        <TopBar
          groups={groups}
          user={{ name: u.name, role: u.role }}
          year={year}
          minYear={y0?.y ?? null}
          canFirms={can(u.principal, 'firms')}
          status={{ bell: st.bell, ainb: st.ainb.length, law: st.law }}
          firm={firm && {
            id: firm.id, name: firm.name, edb: firm.edb, vatRegistered: firm.vatRegistered,
            lockDate: firm.lockDate,
          }}
        />
        <div className="sheet" id="main">
          {u.mustChangePassword && (
            <div className="callout warn">Мора да ја промените привремената лозинка. <a href="/lozinka">Промени лозинка</a></div>
          )}
          {firm && u.role !== 'teren' && <NavBack />}
          {children}
        </div>
      </main>
      {office && <AinbPanel items={st.ainb} current={firm?.id ?? null} />}
      {office && <AlStartup />}
    </div>
  );
}
