/**
 * „💲 AI“ on a monthly client report: a short plain-language summary (Macedonian or Albanian, the firm's `kl.lang`)
 * written ONLY from the report's numbers (`clientReportPrompt`: no firm / partner / person names). Runs on the office's
 * click only, under the monthly AI limit and logged in `ai_usage` (`askText` → `../ai/budget.ts`, purpose
 * `clientReport`). With the limit reached nothing is called and the report keeps its free numbers.
 */
import { eq } from 'drizzle-orm';
import { CLIENT_REPORT_AI_JOB, clientReportPrompt, isReportLang, type ClientReportData } from '@wise/core/office';
import { clientReports, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { askText } from '../ai/ask';
import { aiConfigured } from '../ai/client';
import { AiBudgetError } from '../ai/budget';

export async function runClientReportSummary(db: Tx, id: string): Promise<void> {
  const [r] = await db.select().from(clientReports).where(eq(clientReports.id, id)).limit(1);
  if (!r || r.aiStatus !== 'queued') return;
  try {
    if (!aiConfigured()) throw new Error('AI не е достапен: на серверот не е поставен ANTHROPIC_API_KEY.');
    const lang = isReportLang(r.lang) ? r.lang : 'mk';
    const a = await askText({
      db, prompt: clientReportPrompt(r.data as unknown as ClientReportData, lang), tier: 'quick', purpose: 'clientReport', refId: id,
      userId: r.createdBy, firmId: r.firmId, maxTokens: 700,
    });
    await db.update(clientReports).set({ summary: a.text, aiStatus: 'done', aiError: null, aiModel: a.model }).where(eq(clientReports.id, id));
  } catch (e) {
    const msg = e instanceof AiBudgetError ? `AI е паузиран: ${e.message}` : (e as Error).message || String(e);
    await db.update(clientReports).set({ aiStatus: 'error', aiError: msg }).where(eq(clientReports.id, id));
  }
}

export const clientReportSummary = defineJob<{ id: string }>({
  name: CLIENT_REPORT_AI_JOB,
  async run(data, { db }) {
    if (data?.id) await runClientReportSummary(db, data.id);
  },
});
