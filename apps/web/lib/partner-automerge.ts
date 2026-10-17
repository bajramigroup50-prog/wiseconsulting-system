import 'server-only';
/**
 * „Автоматски спојувај сигурни дупликати“ after a scan bulk save or an Excel / journal import: the certain duplicate
 * partners of the firm are merged (`@wise/db` `autoMergePartnerDups`, with all the merge safety). Never breaks the
 * save it follows; returns a short note for the result message ('' when nothing was merged).
 */
import { autoMergePartnerDupsSafe } from '@wise/db';
import { db } from './db';

export async function autoMergeAfter(firmId: string): Promise<string> {
  const r = await autoMergePartnerDupsSafe(db(), firmId);
  if ('error' in r) { console.error('partner auto-merge', firmId, r.error); return ''; }
  return r.merged ? ` Автоматски споени ${r.merged} дупликати комитенти.` : '';
}

/** The auto-merge note appended to a result message. */
export function withNote<T extends { ok?: string; error?: string }>(s: T, note: string): T {
  if (!note) return s;
  if (s.error) return { ...s, error: s.error + note };
  return { ...s, ok: (s.ok ?? '') + note };
}
