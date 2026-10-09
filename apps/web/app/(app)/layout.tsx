import { requireUser } from '@/lib/auth';
import { currentFirm, currentYear } from '@/lib/context';
import { navFor } from '@/lib/nav';
import { filterNavByModules } from '@/lib/nav-industry';
import { Nav } from '@/components/nav';
import { TopBar } from '@/components/top-bar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const [firm, year] = await Promise.all([currentFirm(u), currentYear()]);
  // Phase 10: views of industry modules that are off for the firm are hidden (FIX LEGACY-MAP 10.4 item 9).
  const groups = filterNavByModules(navFor(u.role), firm, u.role === 'klient');
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
          firm={firm && {
            id: firm.id, name: firm.name, edb: firm.edb, vatRegistered: firm.vatRegistered,
            lockDate: firm.lockDate,
          }}
        />
        <div className="sheet" id="main">
          {u.mustChangePassword && (
            <div className="callout warn">Мора да ја промените привремената лозинка. <a href="/lozinka">Промени лозинка</a></div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
