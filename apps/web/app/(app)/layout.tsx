import { cookies } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { can } from '@wise/core';
import { journals } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { calendarYear, currentFirm, currentYear, firmYearCallout } from '@/lib/context';
import { yearOffNote } from '@/lib/firm-guard';
import { db } from '@/lib/db';
import { OWNER_VIEWS, navFor, withoutViews } from '@/lib/nav';
import { isOfficeOwner } from '@/lib/office-owner';
import { activeLocks } from '@/lib/login-guard';
import { aiBudgetBadge } from '@/lib/ai-budget-status';
import { filterNavByModules } from '@/lib/nav-industry';
import { klNav } from '@/lib/kl-nav';
import { topStatus } from '@/lib/top-status';
import { PREVIEW_COOKIE } from '@/lib/route-guard';
import { klPrevOff } from './klPortal/actions';
import { AinbPanel } from '@/components/ainb';
import { AlStartup } from '@/components/al-startup';
import { FirmGuard } from '@/components/firm-guard';
import { Nav } from '@/components/nav';
import { NavBack } from '@/components/nav-back';
import { TopBar } from '@/components/top-bar';
import { VersionCheck } from '@/components/version-check';
import { RobotPanel } from '@/components/robot/robot-panel';
import { buildId } from '@/lib/build-id';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const [firm, year] = await Promise.all([currentFirm(u), currentYear()]);
  // Phase 10: views of industry modules that are off for the firm are hidden (FIX LEGACY-MAP 10.4 item 9).
  // klient: legacy `klNav` — the sections the office switched on for this firm
  // legacy `S.asClient` (👁 Преглед како клиент, `klPrevOn`): an office user sees this firm as its client does
  const preview = !!firm && u.role !== 'klient' && u.role !== 'teren' && (await cookies()).get(PREVIEW_COOKIE)?.value === firm.id;
  const owner = u.role === 'admin' && await isOfficeOwner(u).catch(() => false);
  // the owner's alert for login locks (5 failures per username / 20 per IP): 🔒 N in the top bar → Корисници
  const locks = owner ? (await activeLocks().catch(() => [])).length : 0;
  // the owner's AI-budget alert (80 % / 100 % of the monthly AI limit): 💲 in the top bar → 💲 AI трошок
  const ai = owner ? await aiBudgetBadge().catch(() => null) : null;
  const groups = u.role === 'klient' || preview ? await klNav(firm, preview)
    // owner-only screens (📊 Продуктивност на вработените) are not in anybody else's menu
    : withoutViews(filterNavByModules(navFor(u.role), firm, false), owner ? [] : OWNER_VIEWS);
  const office = u.role !== 'klient' && u.role !== 'teren' && !preview;
  const [st, [y0], yearNote] = await Promise.all([
    topStatus(u).catch(() => ({ bell: null, ainb: [], law: null, rok: null })),
    // legacy `dataYears()`: the year list starts at the firm's first booked year
    firm ? db().select({ y: sql<number | null>`min(extract(year from ${journals.date}))::int` }).from(journals).where(eq(journals.firmId, firm.id)).catch(() => [{ y: null }]) : Promise.resolve([{ y: null }]),
    // the selected firm does not work in the selected year (`@wise/core/firms/years`) — said, never shown silently
    firm ? firmYearCallout(firm, year).catch(() => null) : Promise.resolve(null),
  ]);
  const cal = calendarYear();
  return (
    // tab / window guard: this page's firm + year go with every post; another tab's switch shows „освежете“
    <FirmGuard firm={firm && { id: firm.id, name: firm.name }} year={year}>
    <div className="app">
      <header className="mbar">
        <div className="brand" title="WISE CONSULTING"><i aria-hidden="true">W</i><span>WISE CONSULTING</span></div>
        <Nav groups={groups} />
      </header>
      <main>
        {/* after a deploy: „Има нова верзија на програмата – 🔄 Освежи“ (old pages call server actions that no longer exist) */}
        <VersionCheck build={buildId()} />
        <TopBar
          groups={groups}
          user={{ name: u.name, role: u.role }}
          year={year}
          minYear={y0?.y ?? null}
          canFirms={can(u.principal, 'firms')}
          status={{ bell: st.bell, ainb: st.ainb.length, law: st.law, locks, ai, rok: st.rok ?? null }}
          firm={firm && {
            id: firm.id, name: firm.name, edb: firm.edb, vatRegistered: firm.vatRegistered,
            lockDate: firm.lockDate,
          }}
        />
        {year !== cal && u.role !== 'teren' && (
          // the working year is not the calendar year: said on every screen (a year chosen by accident is noticed)
          <div className="year-off" role="status" id="yearOff" style={{
            background: '#fef0c7', color: '#7a2e0e', borderBottom: '2px solid #f79009', padding: '6px 16px', fontWeight: 700,
            display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span>📅 ⚠ {yearOffNote(year, cal)}.</span>
            {office && <a className="btn sm" href="/?godina=1">Промени година</a>}
          </div>
        )}
        <div className="sheet" id="main">
          {u.mustChangePassword && (
            <div className="callout warn">Мора да ја промените привремената лозинка. <a href="/lozinka">Промени лозинка</a></div>
          )}
          {firm && u.role !== 'teren' && <NavBack />}
          {yearNote && (
            <div className="callout warn" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>📅 <b>{firm!.name}</b>: {yearNote} Променете ја годината горе или изберете друга фирма.</span>
              {office && can(u.principal, 'saveFirm', firm!.id) && <a className="btn sm" href={`/firmi?sve=1&edit=${firm!.id}`}>Измени ги годините на фирмата</a>}
              {office && <a className="btn sm" href="/firmi">⇄ Фирми во {year}</a>}
            </div>
          )}
          {preview && (
            // legacy `klBanner` 9065, on top of every view while previewing
            <div className="callout" style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', borderColor: 'var(--accent)' }}>
              <span>👁 <b>Преглед како клиент</b> – вака ја гледа програмата клиентот на оваа фирма.</span>
              <form action={klPrevOff} style={{ display: 'contents' }}><button className="btn sm">✕ Излез од прегледот</button></form>
            </div>
          )}
          {children}
        </div>
      </main>
      {office && <AinbPanel items={st.ainb} current={firm?.id ?? null} />}
      {office && <AlStartup />}
      {office && <RobotPanel />}
    </div>
    </FirmGuard>
  );
}
