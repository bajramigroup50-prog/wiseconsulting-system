import 'server-only';
/** Inputs and validated proposals of the AI classification of statement lines (legacy `aiClassify` 4856). */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { openDocsFor } from '@wise/core';
import { bankClassifyAnswers, type ClassifyAnswer } from '@wise/core/bank/parity';
import { bankLines, effectiveChart, loadBankEnv, matchContext } from '@wise/db';
import { loadAiResult } from '@/lib/ai';
import { db } from '@/lib/db';

export async function classifyInput(firmId: string, year: number) {
  return db().transaction(async (tx) => {
    const env = await loadBankEnv(tx, firmId);
    const ctx = await matchContext(tx, env, year);
    const open = await tx.select({ id: bankLines.id, date: bankLines.date, amount: bankLines.amount, desc: bankLines.description }).from(bankLines)
      .where(and(eq(bankLines.firmId, firmId), isNull(bankLines.konto), isNull(bankLines.refId), sql`${bankLines.date} between ${year + '-01-01'} and ${year + '-12-31'}`)).limit(300);
    const chart = await effectiveChart(tx, firmId);
    const pn = new Map(env.partners.map((p) => [p.id, p.name]));
    const docs = [
      ...openDocsFor({ id: 'x', acct: '', date: `${year}-12-31`, amount: 1, desc: '' }, ctx).O.map((z) => ({ type: 'invoice' as const, id: z.x.id, number: z.x.number, partnerName: pn.get(z.x.partner ?? '') ?? '', open: z.o })),
      ...openDocsFor({ id: 'x', acct: '', date: `${year}-12-31`, amount: -1, desc: '' }, ctx).O.map((z) => ({ type: 'purchase' as const, id: z.x.id, number: z.x.number, partnerName: pn.get(z.x.partner ?? '') ?? '', open: z.o })),
    ];
    const bankKontos = env.accounts.map((a) => a.konto);
    return { open, chart, docs, bankKontos };
  });
}


/** Validated proposals of a finished read (legacy 4879–4882). */
export async function bankClassifyProposals(firmId: string, year: number, aiId: string): Promise<ClassifyAnswer[] | null> {
  const d = await loadAiResult(firmId, aiId, 'bankcls');
  if (!d) return null;
  const x = await classifyInput(firmId, year);
  return bankClassifyAnswers(d.result, {
    lines: new Map(x.open.map((l) => [l.id, { amount: Number(l.amount) }])),
    docs: new Set(x.docs.map((z) => (z.type === 'invoice' ? 'inv:' : 'pur:') + z.id)),
    chart: new Set(x.chart.map((a) => a.code)), bankKontos: x.bankKontos,
  });
}

