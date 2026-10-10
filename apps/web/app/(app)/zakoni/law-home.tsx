import { LAW_INST, lawNew } from '@wise/core/law';
import { loadLaw, lawSeenOf } from '@/lib/law';
import { Robot, RobotCss } from './robot';

/** Legacy `VIEWS.home` wrapper (14347 + robot 14398): callout with the new changes on the dashboard. */
export async function LawHome({ userId, role }: { userId: string; role: string }) {
  if (role === 'klient' || role === 'teren') return null;
  const [L, seen] = await Promise.all([loadLaw(), lawSeenOf(userId)]);
  const N = lawNew(L, seen);
  if (!N.length) return null;
  return (
    <div className="callout" id="lawHome" style={{ borderLeft: '4px solid var(--accent)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <RobotCss /><Robot size={54} alert id="rbh" />
      <div style={{ flex: 1 }}><b>{N.length}</b> нови законски промени: {N.slice(0, 3).map((y) => `${LAW_INST[y.inst] ?? ''} – ${y.title}`).join(' · ')}{N.length > 3 ? ' …' : ''} <a className="btn sm pri" href="/zakoni">Види →</a></div>
    </div>
  );
}
