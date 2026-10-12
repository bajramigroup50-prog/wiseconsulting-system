import 'server-only';
/**
 * The owner's AI-budget badge in the top bar („💲 82 %“ from 80 %, red „💲 AI паузирано“ at 100 %), linking to
 * „💲 AI трошок“. Office-wide limit only; a firm's own limit shows in the report.
 */
import { aiBudgetStatus } from '@wise/db';
import { pct } from '@wise/core/ai/cost';
import { db } from './db';

export interface AiBudgetBadge { level: 80 | 100; pct: number; msg: string }

export async function aiBudgetBadge(): Promise<AiBudgetBadge | null> {
  const s = await aiBudgetStatus(db(), null);
  if (!s.level) return null;
  return { level: s.level, pct: pct(s.spent, s.limit) ?? 100, msg: s.msg };
}
