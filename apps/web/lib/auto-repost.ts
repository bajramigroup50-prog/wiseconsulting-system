import 'server-only';
/**
 * UX Phase 3 (P31): after a change of the posting schemes / bank kontos / chart — per firm a background re-post (the
 * owner switched „автоматски“ on) or a „Прекнижи“ suggestion (off, the default). Server-only helpers (NOT server
 * actions): the callers are the guarded actions that saved the change.
 */
import type { RepostReason } from '@wise/core/repost';
import { noteRepostChange, REPOST_JOB, type RepostNote } from '@wise/db';
import { db } from './db';
import { enqueue } from './jobs';

/** Send the queued runs (after the change was committed). A queue failure leaves the run queued (shown as such). */
export async function sendRepostRuns(note: RepostNote): Promise<number> {
  let n = 0;
  for (const q of note.queue) {
    try { await enqueue(REPOST_JOB, q); n++; } catch (e) { console.warn('[books.repost]', (e as Error).message); }
  }
  return n;
}

/** Note the change (after the saving transaction). Returns a sentence for the action's message; never throws. */
export async function queueRepostChange(a: { firmIds: readonly string[] | 'all'; reason: RepostReason; year: number; userId: string | null }): Promise<string> {
  try {
    const note = await db().transaction((tx) => noteRepostChange(tx, a));
    const sent = await sendRepostRuns(note);
    return sent ? ` Книжените документи се прекнижуваат во позадина (${sent} ${sent === 1 ? 'фирма' : 'фирми'}, само отворени периоди).`
      : note.due ? ' Книжените документи останаа со старите конта – предложено е „Прекнижи“.' : '';
  } catch (e) {
    console.warn('[repost note]', (e as Error).message);
    return '';
  }
}
