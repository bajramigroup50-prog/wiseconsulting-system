/**
 * `incoming.detect` — „📥 Пристигнати документи“ (UX P7 / P32): find the type of one inbox file FREE FIRST (the file
 * format, the XML root, the bank-statement detector, the text of a PDF / Word — `@wise/core/office` `detectIncoming`);
 * a photo / scan stays „непрепознаено“ until the user asks the AI (on the screen, under the budget guard).
 *
 * A bank statement (XML / MT940 / КБ / CSV, or a text PDF that reconciles) is then matched to a firm by its account /
 * IBAN and imported AUTOMATICALLY into the file's own firm (the existing import: reconciliation, duplicates, the bank
 * nalog of the period); another firm the uploader may book into is only proposed; none → it waits.
 * With `firmId` (the user confirmed the firm on the screen) the statement is imported into that firm.
 * Errors are stored on the row; the job never throws (no pg-boss retry).
 */
import { eq } from 'drizzle-orm';
import { statementsFromRead } from '@wise/core/ai/bank';
import { detectIncoming, INCOMING_JOB, statementBriefs } from '@wise/core/office';
import { lineText, pdfLines } from '@wise/core/noai/pdf-lines';
import type { Statement } from '@wise/core/bank-parsers';
import { files, firms, incomingBankAuto, incomingBankImport, incomingDocs, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { readObject } from '../ai/storage';
import { pdfTextItems } from '../ai/pdf-text';
import { docxText } from '../ai/docx-text';
import { freeAccepted, freeRead } from '../ai/free-read';

const isPdf = (f: { name: string; mime: string }) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name);
const isDocx = (f: { name: string; mime: string }) => /\.docx$/i.test(f.name) || /wordprocessingml/.test(f.mime);

export async function runIncomingDetect(db: Tx, id: string, o: { firmId?: string | null; log?: (m: string) => void } = {}): Promise<void> {
  const log = o.log ?? (() => {});
  const [r] = await db.select().from(incomingDocs).where(eq(incomingDocs.id, id)).limit(1);
  if (!r || r.status === 'done') return;
  try {
    const [f] = await db.select().from(files).where(eq(files.id, r.fileId)).limit(1);
    if (!f || f.status !== 'ready') throw new Error('Датотеката не е пронајдена.');
    const [firm] = r.firmId ? await db.select({ edb: firms.edb }).from(firms).where(eq(firms.id, r.firmId)).limit(1) : [];
    const bytes = await readObject(f.bucketKey);
    let text: string | null = null;
    if (isPdf(f)) { try { text = pdfLines(await pdfTextItems(bytes)).map(lineText).join('\n'); } catch { text = null; } }
    else if (isDocx(f)) text = docxText(bytes);
    const d = detectIncoming(f, bytes, { text, ownEdb: firm?.edb });
    let statements: Statement[] = d.statements ?? [];
    let format = d.format ?? '';
    // a statement PDF with a text layer: read without AI, used only when its balances reconcile
    if (d.kind === 'bank' && !statements.length && isPdf(f)) {
      const fr = await freeRead('bank', f, bytes).catch(() => null);
      if (freeAccepted('bank', fr)) { statements = statementsFromRead(fr); format = 'pdf'; }
    }
    await db.update(incomingDocs).set({
      kind: d.kind, how: d.how, what: d.what, status: r.status === 'skipped' ? 'skipped' : 'read',
      detect: { ...r.detect, needsAi: d.needsAi, ...(format ? { format } : {}), ...(statements.length ? { statements: statementBriefs(statements) } : {}) },
      ...(d.kind === 'bank' && !statements.length ? { result: 'Изводот не се чита без AI (скениран или салдата не се совпаѓаат) – увезете го во Изводи (PDF / слика се чита со AI).' } : {}),
    }).where(eq(incomingDocs.id, id));
    if (d.kind !== 'bank' || !statements.length || r.status === 'skipped') { log(`${id}: ${d.kind} (${d.how})`); return; }
    const out = await db.transaction((tx) => (o.firmId
      ? incomingBankImport(tx as unknown as Tx, { id, firmId: o.firmId, statements, format, userId: r.createdBy, auto: false })
      : incomingBankAuto(tx as unknown as Tx, { id, statements, format })));
    log(`${id}: bank → ${out.status} ${out.result}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(incomingDocs).set({ status: 'read', result: `Грешка: ${msg}`.slice(0, 500) }).where(eq(incomingDocs.id, id));
    log(`${id}: ${msg}`);
  }
}

export const incomingDetect = defineJob<{ id: string; firmId?: string | null }>({
  name: INCOMING_JOB,
  queue: { retryLimit: 0, expireInSeconds: 10 * 60 },
  async run(data, { db, log }) {
    if (data?.id) await runIncomingDetect(db as unknown as Tx, data.id, { firmId: data.firmId ?? null, log });
  },
});
