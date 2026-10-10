'use server';
/**
 * Legacy `aiClassify` 4856 (called by „Прокнижи автоматски“ after `autoMatch`): the lines that no rule matched are
 * classified by AI — an open document they settle or a counter konto, with a short reason („автоматски – провери“).
 * The read is the worker job (kind `bankcls`, prompt verbatim); the proposals are reviewed and applied here.
 */
import { eq, sql } from 'drizzle-orm';
import { bankClassifyLists } from '@wise/core/bank/parity';
import { audit, bankLines, linkLine, setLineKonto } from '@wise/db';
import { bankClassifyProposals, classifyInput } from './classify';
import { firmAction } from '@/lib/books';
import { dispatchAiReads, markAiReadsSaved, queueAiReads } from '@/lib/ai';
import { bankRun } from '@/lib/bank';
import { db } from '@/lib/db';
import type { FormState } from '@/components/bank-form';

const P = ['/banka', '/devizni', '/bkAdv', '/nalozi'];

/** Start the AI classification of the unbooked lines of the year. */
export async function startBankClassifyAction(): Promise<{ id?: string; error?: string }> {
  try {
    const { u, firm, year } = await firmAction('autoMatch');
    const x = await classifyInput(firm.id, year);
    if (!x.open.length) return { error: 'Нема непрокнижени ставки.' };
    const lists = bankClassifyLists({
      chart: x.chart.map((a) => ({ code: a.code, name: a.name })), bankKontos: x.bankKontos, docs: x.docs,
      lines: x.open.map((l) => ({ id: l.id, date: l.date, amount: Math.round(Number(l.amount) * 100), desc: l.desc })),
    });
    const [id] = await db().transaction(async (tx) => {
      const ids = await queueAiReads(tx, { firmId: firm.id, userId: u.id, kind: 'bankcls', fileIds: null, options: { ...lists, year } });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'aiClassify', entityType: 'ai_document', entityId: ids[0], data: { lines: x.open.length } });
      return ids;
    });
    await dispatchAiReads([id!]);
    return { id: id! };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Препознавањето не успеа.' };
  }
}

/** Apply the ticked proposals: link the document or book the konto; mark them „автоматски – провери“ with the reason. */
export async function applyBankClassifyAction(_p: FormState, form: FormData): Promise<FormState> {
  const aiId = String(form.get('ai') ?? '');
  const accept = new Set(form.getAll('accept').map(String));
  if (!accept.size) return { error: 'Не е избрана ниту една ставка.' };
  const { firm, year } = await firmAction('autoMatch');
  const R = (await bankClassifyProposals(firm.id, year, aiId)) ?? [];
  const L = R.filter((r) => accept.has(r.id));
  return bankRun('autoMatch', P, async ({ tx, u }) => {
    let n = 0;
    for (const r of L) {
      if (r.ref) await linkLine(tx, { firmId: firm.id, userId: u.id, year, lineId: r.id, docIds: [r.ref.id] });
      else if (r.konto) await setLineKonto(tx, { firmId: firm.id, userId: u.id, lineId: r.id, konto: r.konto, learn: false });
      else continue;
      await tx.update(bankLines).set({ auto: 'ai', data: sql`${bankLines.data} || ${JSON.stringify({ ai: r.reason })}::jsonb` }).where(eq(bankLines.id, r.id));
      n++;
    }
    await markAiReadsSaved(tx, firm.id, [aiId]);
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'aiClassifyApply', entityType: 'bank_line', data: { n, ids: L.map((r) => r.id) } });
    return n ? `Автоматски прокнижени ${n} ставки. Проверете ги ознаките „препознаено – провери“.` : 'Ставките не се препознаени; изберете рачно.';
  });
}
