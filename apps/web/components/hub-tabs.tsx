/**
 * Tab strip of a tab-container screen (`lib/nav-hubs.ts`, UX Phase 1 P5 / P8 / P9): every tab is the existing page at
 * its own address, shown only when the user may open it (`screenMay`). Nothing is rendered when fewer than two tabs
 * are allowed (the screen is then just the page it always was).
 * Awaited by the page itself (`{await hubTabs('zakoni', 'lawAi')}`), so the strip is plain markup (no nested async
 * component).
 */
import Link from 'next/link';
import { hubByKey, tabHref, visibleTabs } from '@/lib/nav-hubs';
import { screenMay } from '@/lib/hub-access';

/** `currentHref`: the address of the current tab when two tabs share one view (e.g. `/banka` and `/banka/pregled`). */
export async function hubTabs(key: string, current: string, currentHref?: string): Promise<React.ReactElement | null> {
  const hub = hubByKey(key);
  if (!hub) return null;
  const T = visibleTabs(hub, await screenMay());
  if (T.length < 2) return null;
  return (
    <nav className="hubtabs noprint" aria-label={hub.label} data-hub={hub.key}>
      <span className="hubt">{hub.label}</span>
      {T.map((t) => {
        const cur = currentHref ? tabHref(t) === currentHref : t.view === current;
        return <Link key={tabHref(t)} href={tabHref(t)} aria-current={cur ? 'page' : undefined} className={cur ? 'cur' : ''}>{t.label}</Link>;
      })}
    </nav>
  );
}
