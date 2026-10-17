'use server';
/**
 * UX Phase 3 (P3/P29) — „Поврзување“ (Изводи tab, was „Плаќања без фактура“): bulk accept / reject of the proposed
 * payment ↔ invoice links and „↻ Предложи врски“ for the whole year. Accepting re-allocates against the current open
 * amounts and re-posts each statement once; locked periods are skipped. Audited (`bankLinkAccept` / `bankLinkReject`).
 */
import { acceptLinks, proposeLinks, rejectLinks } from '@wise/db';
import { firmAction } from '@/lib/books';
import { bankRun } from '@/lib/bank';
import type { FormState } from '@/components/bank-form';
import { runPayNotes } from '../banka/paynotes';

const P = ['/bkAdv', '/banka', '/banka/pregled', '/devizni', '/nalozi', '/kartici'];
const UUID = /^[0-9a-f-]{36}$/i;

export async function linksAction(_p: FormState, form: FormData): Promise<FormState> {
  const ids = form.getAll('ln').map(String).filter((x) => UUID.test(x));
  const reject = form.get('do') === 'reject';
  if (!ids.length) return { error: 'Не е избрана ниту една врска.' };
  if (reject) {
    return bankRun('write', P, async ({ tx, u, firm }) => {
      const n = await rejectLinks(tx, { firmId: firm.id, userId: u.id, lineIds: ids });
      return `Одбиени ${n} предлози (нема повторно да се предложат за истите фактури).`;
    });
  }
  const res = await bankRun('write', P, async ({ tx, u, firm }) => {
    const r = await acceptLinks(tx, { firmId: firm.id, userId: u.id, lineIds: ids });
    return `Поврзани ${r.linked} плаќања со фактури (${r.statements} изводи прекнижани).`
      + (r.skipped.length ? ` Прескокнати ${r.skipped.length}: ${[...new Set(r.skipped.map((s) => s.why))].join('; ')}.` : '');
  });
  if (!res.error) { try { const c = await firmAction('write'); await runPayNotes(c.firm, c.u.id, c.year); } catch { /* notifications never fail the link */ } }
  return res;
}

/** „↻ Предложи врски“: proposals for every payment of the year without a document (rejected ones stay rejected). */
export async function proposeLinksAction(): Promise<FormState> {
  return bankRun('write', P, async ({ tx, u, firm, year }) => {
    const r = await proposeLinks(tx, { firmId: firm.id, userId: u.id, year });
    return r.length ? `Предложени ${r.length} врски (${r.filter((p) => p.conf === 'sure').length} сигурни).` : 'Нема нови предлози.';
  });
}
