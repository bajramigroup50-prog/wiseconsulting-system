'use server';
/**
 * UX Phase 3 (P2/P28) — „Преглед за книжење“: „✓ Прокнижи ги сигурните“ / „✓ Прокнижи ги избраните“ (the review is
 * recomputed on the server, the lines are booked through `bookStatementLines`, each statement re-posted once), and
 * the owner's „автоматски“ switches per firm (all OFF by default; only the office owner may change them).
 */
import { revalidatePath } from 'next/cache';
import { confirmReview, saveAutoSteps } from '@wise/db';
import { firmAction } from '@/lib/books';
import { bankRun } from '@/lib/bank';
import { db } from '@/lib/db';
import { isOfficeOwner, OWNER_ONLY_MSG } from '@/lib/office-owner';
import type { FormState } from '@/components/bank-form';
import { runPayNotes } from './paynotes';

const P = ['/banka', '/banka/pregled', '/devizni', '/bkAdv', '/nalozi'];
const UUID = /^[0-9a-f-]{36}$/i;

export async function confirmReviewAction(_p: FormState, form: FormData): Promise<FormState> {
  const sure = form.get('mode') === 'sure';
  const ids = form.getAll('ln').map(String).filter((x) => UUID.test(x));
  if (!sure && !ids.length) return { error: 'Не е избрана ниту една ставка.' };
  const res = await bankRun('write', P, async ({ tx, u, firm }) => {
    const r = await confirmReview(tx, { firmId: firm.id, userId: u.id, ...(sure ? { onlySure: true } : { lineIds: ids }) });
    if (!r.booked && !r.skipped.length) return sure ? 'Нема „сигурни“ ставки за книжење.' : 'Избраните ставки немаат предлог – прокнижете ги рачно.';
    return `Прокнижени ${r.booked} ставки во ${r.statements} изводи${r.numbers.length ? ` (налог ${r.numbers.join(', ')})` : ''}.`
      + (r.skipped.length ? ` Непрокнижени ${r.skipped.length}: ${r.skipped.slice(0, 8).map((s) => `ред ${s.lineNo} – ${s.why}`).join('; ')}.` : '');
  });
  // payment confirmations to customers (legacy `pnRun`) never fail the booking
  if (!res.error) { try { const c = await firmAction('write'); await runPayNotes(c.firm, c.u.id, c.year); } catch { /* ignore */ } }
  return res;
}

/** The owner's switches (Изводи → ⚙ Поставки). */
export async function saveAutoStepsAction(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const { u, firm } = await firmAction('settings');
    if (!(await isOfficeOwner(u))) return { error: OWNER_ONLY_MSG };
    const steps = { book: form.get('book') === 'on', link: form.get('link') === 'on', repost: form.get('repost') === 'on' };
    await db().transaction((tx) => saveAutoSteps(tx, { firmId: firm.id, userId: u.id, steps }));
    for (const p of P) revalidatePath(p);
    const on = Object.entries(steps).filter(([, v]) => v).length;
    return { ok: on ? `Зачувано: вклучени ${on} автоматски чекори за оваа фирма.` : 'Зачувано: сите автоматски чекори се исклучени (програмата само предлага).' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Грешка.' };
  }
}
