'use server';
/**
 * „🗂 Целосен извештај за фирма“ — the office OWNER's only action: „💲 AI анализа“. The report is computed again for the
 * chosen firm (free), the payload (numbers + findings, no names / ЕДБ / personal data) is stored with the request and
 * the worker (`firm-report.ai`) writes the analysis under the monthly AI limit. Refused while the limit is reached.
 */
import { revalidatePath } from 'next/cache';
import { FIRM_REPORT_AI_JOB } from '@wise/core/office/firm-report';
import { aiBudgetStatus, audit, firmReportAiState, putFirmReportAiState, queueFirmReportAi } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { officeError } from '@/lib/office';
import { fiOwnerAction, fiParams, fiReport } from './lib';
import { assertFirmSide } from '@/lib/demo-office';

export async function firmReportAiAction(firmId: string, year: number, to: string | null): Promise<ActionState> {
  try {
    const u = await fiOwnerAction();
    const p = fiParams({ f: firmId, y: String(year), do: to ?? undefined });
    if (!p.f) return { error: 'Изберете фирма.' };
    // 🎭 the firm must be of the owner's side (a demo admin: a demo firm) before anything is read about it
    await assertFirmSide(u, p.f);
    const cur = await firmReportAiState(db(), p.f, p.y);
    if (cur?.status === 'queued' && cur.at && Date.now() - Date.parse(cur.at) < 10 * 60_000) return { ok: 'AI анализата веќе се пишува…' };
    const b = await aiBudgetStatus(db(), p.f);
    if (b.paused) return { error: `AI е паузиран: ${b.msg}` };
    const R = await fiReport(u, { ...p, f: p.f });
    if (!R) return { error: 'Фирмата не постои.' };
    const s = await queueFirmReportAi(db(), R, u.id);
    await audit(db(), { userId: u.id, firmId: p.f, action: 'frAi', entityType: 'firm', entityId: p.f, data: { year: p.y, to: R.to } });
    try { await enqueue(FIRM_REPORT_AI_JOB, { firmId: p.f, year: p.y, reqId: s.reqId }); } catch {
      await putFirmReportAiState(db(), { ...s, status: 'error', error: 'Редот за задачи е недостапен – обидете се повторно.', payload: undefined });
      return { error: 'Редот за задачи е недостапен – обидете се повторно.' };
    }
    revalidatePath('/firmIzv');
    return { ok: '💲 AI ја пишува анализата (неколку секунди)…' };
  } catch (e) { return officeError(e); }
}
