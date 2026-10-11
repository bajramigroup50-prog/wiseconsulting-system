import { LAW_INST, lawNew } from '@wise/core/law';
import { lawRuns } from '@wise/db';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { loadLaw, lawSeenOf } from '@/lib/law';
import { Robot, RobotCss } from './robot';

/**
 * Legacy `VIEWS.home` wrapper (14347 + robot 14398): callout with the new changes on the dashboard.
 * Legacy read the stored office-wide changes (`applaw`); on a fresh server nothing is stored until the robot's first
 * check, so the dashboard starts that check once (it runs daily at 06:52 afterwards).
 */
export async function LawHome({ userId, role }: { userId: string; role: string }) {
  if (role === 'klient' || role === 'teren') return null;
  const [L, seen, runs] = await Promise.all([loadLaw(), lawSeenOf(userId), db().select({ id: lawRuns.id }).from(lawRuns).limit(1)]);
  if (!runs.length) { try { await enqueue('law.robot', {}); } catch { /* queue unavailable — the daily cron runs it */ } }
  const N = lawNew(L, seen);
  if (!N.length) return null;
  return (
    <div className="callout" id="lawHome" style={{ borderLeft: '4px solid var(--accent)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <RobotCss /><Robot size={54} alert id="rbh" />
      <div style={{ flex: 1 }}><b>{N.length}</b> нови законски промени: {N.slice(0, 3).map((y) => `${LAW_INST[y.inst] ?? ''} – ${y.title}`).join(' · ')}{N.length > 3 ? ' …' : ''} <a className="btn sm pri" href="/zakoni">Види →</a></div>
    </div>
  );
}
