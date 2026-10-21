import { cookies } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { can } from '@wise/core';
import { journals } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { calendarYear, currentFirm, currentYear, firmYearCallout } from '@/lib/context';
import { yearOffNote } from '@/lib/firm-guard';
import { db } from '@/lib/db';
import { OWNER_VIEWS, navFor, onlyViews, withoutViews } from '@/lib/nav';
import { DEMO_BANNER } from '@wise/core/demo';
import { isDemoUser } from '@/lib/demo';
import { demoViews } from '@/lib/route-guard';
import { myViews } from '@/lib/can-see';
import { isOfficeOwner } from '@/lib/office-owner';
import { activeLocks } from '@/lib/login-guard';
import { aiBudgetBadge } from '@/lib/ai-budget-status';
import { filterNavByModules } from '@/lib/nav-industry';
import { newMenu } from '@/lib/nav-new';
import { searchIndex } from '@/lib/nav-search';
import { menuStyleOf } from '@/lib/menu-style';
import { klNav } from '@/lib/kl-nav';
import { topStatus } from '@/lib/top-status';
import { PREVIEW_COOKIE } from '@/lib/route-guard';
import { klPrevOff } from './klPortal/actions';
import { AinbPanel } from '@/components/ainb';
import { AlStartup } from '@/components/al-startup';
import { DatalistFull } from '@/components/datalist-full';
import { FirmGuard } from '@/components/firm-guard';
import { Nav } from '@/components/nav';
import { NavBack } from '@/components/nav-back';
import { TopBar } from '@/components/top-bar';
import { VersionCheck } from '@/components/version-check';
import { DesktopPdfGuard } from '@/components/desktop-pdf-guard';
import { RobotPanel } from '@/components/robot/robot-panel';
import { buildId } from '@/lib/build-id';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const [firm, year] = await Promise.all([currentFirm(u), currentYear()]);
  // Phase 10: views of industry modules that are off for the firm are hidden (FIX LEGACY-MAP 10.4 item 9).
  // klient: legacy `klNav` — the sections the office switched on for this firm
  // legacy `S.asClient` (👁 Преглед како клиент, `klPrevOn`): an office user sees this firm as its client does
  // 🎭 demo user: the menu is the demo allow-list only (the same list `proxy.ts` enforces)
  const demo = isDemoUser(u);
  // independent lookups run together (this layout runs on every full page load)
  const [jar, owner, bookV, style] = await Promise.all([
    cookies(),
    u.role === 'admin' ? isOfficeOwner(u).catch(() => false) : Promise.resolve(false),
    // 🔒 „Колегите гледаат само сметководство“: a colleague's menu is the bookkeeping allow-list (the same list `proxy.ts`
    // enforces); the top bar's office-wide parts (robot, alerts, client messages, AI budget, deadlines) are hidden
    demo ? Promise.resolve(null) : myViews(),
    // P40 „Мени: класично / ново“ (default „ново“; the klient / teren menus never change)
    u.role === 'klient' || u.role === 'teren' ? Promise.resolve('classic' as const) : menuStyleOf(db(), u.id).catch(() => 'new' as const),
  ]);
  const preview = !!firm && u.role !== 'klient' && u.role !== 'teren' && jar.get(PREVIEW_COOKIE)?.value === firm.id;
  const [locks, ai] = owner ? await Promise.all([
    // the owner's alert for login locks (5 failures per username / 20 per IP): 🔒 N in the top bar → Корисници
    activeLocks().then((l) => l.length).catch(() => 0),
    // the owner's AI-budget alert (80 % / 100 % of the monthly AI limit): 💲 in the top bar → 💲 AI трошок
    aiBudgetBadge().catch(() => null),
  ]) : [0, null] as const;
  const book = !!bookV;
  const seeFirmi = !bookV || bookV.has('firmi');
  const classic = demo ? onlyViews(filterNavByModules(navFor(u.role === 'klient' || u.role === 'teren' ? 'acc' : u.role), firm, false), demoViews())
    : u.role === 'klient' || preview ? await klNav(firm, preview)
    : bookV ? onlyViews(withoutViews(filterNavByModules(navFor(u.role), firm, false), owner ? [] : OWNER_VIEWS), bookV)
    // owner-only screens (📊 Продуктивност на вработените) are not in anybody else's menu
    : withoutViews(filterNavByModules(navFor(u.role), firm, false), owner ? [] : OWNER_VIEWS);
  const office = u.role !== 'klient' && u.role !== 'teren' && !preview;
  // UX Phase 1 „ново“ menu: applied LAST, on the already filtered menu (it only removes / moves / groups items), so the
  // access rules are those of the classic menu; the klient / teren / client-preview menus are never changed
  const fresh = office && style === 'new';
  const groups = fresh ? newMenu(classic) : classic;
  // P25 Ctrl+K: the screens of the filtered menu (+ the own profile), by new and old names
  const search = office ? searchIndex(classic, groups, [['lozinka', 'Мојот профил / лозинка / мени']]) : null;
  const noStatus = { bell: null, ainb: [], law: null, rok: null };
  const [st, [y0], yearNote] = await Promise.all([
    book ? Promise.resolve(noStatus) : topStatus(u).catch(() => noStatus),
    // legacy `dataYears()`: the year list starts at the firm's first booked year
    firm ? db().select({ y: sql<number | null>`extract(year from min(${journals.date}))::int` }).from(journals).where(eq(journals.firmId, firm.id)).catch(() => [{ y: null }]) : Promise.resolve([{ y: null }]),
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
        <Nav groups={groups} search={search} fresh={fresh} />
      </header>
      <main>
        {demo && (
          // 🎭 on every page of a demo session (also the marker `lib/fiscal-bridge.ts` reads: no fiscal printing)
          <div data-wise-demo="1" role="status" style={{
            background: '#fde047', color: '#422006', borderBottom: '2px solid #ca8a04', padding: '6px 16px', fontWeight: 700, textAlign: 'center',
          }}>{DEMO_BANNER}</div>
        )}
        {/* after a deploy: „Има нова верзија на програмата – 🔄 Освежи“ (old pages call server actions that no longer exist) */}
        <VersionCheck build={buildId()} />
        {/* desktop app: files / PDFs / prints open in their own window, never over the program */}
        <DesktopPdfGuard />
        <TopBar
          groups={groups}
          user={{ name: u.name, role: u.role }}
          year={year}
          minYear={y0?.y ?? null}
          canFirms={can(u.principal, 'firms') && !book}
          book={book}
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
              {office && seeFirmi && can(u.principal, 'saveFirm', firm!.id) && <a className="btn sm" href={`/firmi?sve=1&edit=${firm!.id}`}>Измени ги годините на фирмата</a>}
              {office && <a className="btn sm" href={seeFirmi ? '/firmi' : '/izlezF'}>⇄ Фирми во {year}</a>}
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
      {office && !demo && !book && <AinbPanel items={st.ainb} current={firm?.id ?? null} />}
      {office && !demo && !book && <AlStartup />}
      <DatalistFull />
      {office && !demo && !book && <RobotPanel />}
    </div>
    </FirmGuard>
  );
}
