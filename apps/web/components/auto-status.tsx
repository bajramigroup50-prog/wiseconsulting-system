/**
 * P42 (UX Phase 1): the work a scheduled job already does is shown as a status line, „Проверено автоматски: денес
 * 06:52 · ↻“, instead of a big „Провери сега“ button. `refresh` = the small ↻ (owner / administrator only, decided by
 * the page; the server action keeps its own permission check).
 */
import { addDays, todaySkopje } from '@wise/core/office';
import { dmyHm } from './hd';

const hm = (d: Date) => d.toLocaleTimeString('mk-MK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Skopje' });

/** „денес 06:52“, „вчера 06:52“ or „16.10.2026 06:52“ (Skopje time). */
export function whenText(at: Date, now = new Date()): string {
  const d = todaySkopje(at), td = todaySkopje(now);
  return d === td ? `денес ${hm(at)}` : d === addDays(td, -1) ? `вчера ${hm(at)}` : dmyHm(at);
}

export function AutoStatus({ at, label = 'Проверено автоматски', when, refresh }: {
  at: Date | null | undefined; label?: string;
  /** When the job runs (tooltip), e.g. „секој ден во 06:52“. */
  when?: string;
  refresh?: React.ReactNode;
}) {
  return (
    <span className="autost" role="status" title={when ? `Автоматски: ${when}` : undefined}>
      <span>{label}: <b>{at ? whenText(at) : 'сè уште не'}</b></span>
      {refresh && <>· {refresh}</>}
    </span>
  );
}
