/**
 * The address of a tab-container screen (UX Phase 1 P5 / P8 / P9, `lib/nav-hubs.ts`): `/ekran/zakoni`,
 * `/ekran/rokovi?t=zsRok`, `/ekran/izvodiCfg?t=bankFmt`. It renders nothing itself: it forwards to the asked tab when the
 * user may open it, otherwise to the first tab they may open, and refuses (404) when they may open none — the same
 * rule the route guard applies to `/ekran/…` for 🎭 demo users and 🔒 book-only colleagues (`allowListVerdict`).
 */
import { notFound, redirect } from 'next/navigation';
import { hubByKey, hubTarget } from '@/lib/nav-hubs';
import { screenMay } from '@/lib/hub-access';

export default async function HubPage({ params, searchParams }: { params: Promise<{ hub: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ hub: key }, sp] = await Promise.all([params, searchParams]);
  const hub = hubByKey(key);
  if (!hub) notFound();
  const to = hubTarget(hub, await screenMay(), sp.t);
  if (!to) notFound();
  redirect(to);
}
