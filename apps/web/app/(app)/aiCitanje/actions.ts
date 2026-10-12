'use server';
/**
 * Систем › 🤖 AI читање — „🔎 Провери го AI-кредитот сега“ (administrator). The API key lives only in the worker's
 * environment, so the check is the worker job `ai.ping` (one 1-token request with the cheapest model); the action waits
 * for its result (`app_settings.ai.lastPing` with this request's id). Success clears the remembered credit / key
 * failure, so the next reads use AI at once.
 */
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { audit, getAiSettings } from '@wise/db';
import { Forbidden, requireUser } from '@/lib/auth';
import { actionError, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';

const AI_PING = 'ai.ping';
const WAIT_MS = 30_000;
const STEP_MS = 500;

export async function aiPingAction(): Promise<ActionState> {
  try {
    const u = await requireUser();
    if (u.role !== 'admin') throw new Forbidden('aiPing');
    const id = randomUUID();
    await db().transaction(async (tx) => {
      await audit(tx, { userId: u.id, firmId: null, action: 'aiPing', entityType: 'app_settings', data: { id } });
    });
    await enqueue(AI_PING, { id });
    const end = Date.now() + WAIT_MS;
    for (;;) {
      const p = (await getAiSettings(db())).lastPing;
      if (p?.id === id) {
        revalidatePath('/aiCitanje');
        revalidatePath('/sistem');
        return p.ok ? { ok: p.msg } : { error: p.msg };
      }
      if (Date.now() >= end) return { error: 'Проверката сè уште не заврши (работникот е зафатен или не работи) – освежете ја страницата за минута.' };
      await new Promise((r) => setTimeout(r, STEP_MS));
    }
  } catch (e) { return actionError(e); }
}
