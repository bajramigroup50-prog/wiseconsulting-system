'use server';
/**
 * Journal import from the old program (`/uvoz?t=journal`): preview → confirm (one transaction per batch, one audit
 * row) → „🗑 Избриши го увозот“. Permissions: `impRun` (write) for the preview and the import, `nalDel` (delete) for
 * removing a batch; the firm and the working year are the session's (a demo user only reaches the demo firms, and
 * the file of these actions belongs to the `uvoz` view of the route guard).
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { commitJournalImport, deleteJournalImport, JournalImportError, PostingError, previewJournalImport, type JiPreview, type JiResult } from '@wise/db';
import { finNalogJournalGrid, finNalogsFromLines } from '@wise/core/noai/fin-nalog';
import { pdfLines } from '@wise/core/noai/pdf-lines';
import { Forbidden } from '@/lib/auth';
import { actionError, firmAction } from '@/lib/books';
import { db } from '@/lib/db';
import { pdfTextItems } from '@/lib/pdf-text';
import type { Tx } from '@wise/db';

const In = z.object({
  file: z.string().max(300), hash: z.string().max(128),
  createPartners: z.boolean().optional(), skipOpening: z.boolean().optional(),
  mode: z.enum(['journal', 'invoices']).optional(),
  nalog: z.object({ type: z.string().max(40).optional(), no: z.string().max(40).optional() }).optional(),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).max(100000),
});

type R<T> = { data?: T; error?: string };

async function run<T>(action: string, f: (tx: Tx, a: { firmId: string; userId: string; year: number; role: string }) => Promise<T>): Promise<R<T>> {
  try {
    const { u, firm, year } = await firmAction(action);
    return { data: await db().transaction((tx) => f(tx as unknown as Tx, { firmId: firm.id, userId: u.id, year, role: u.role })) };
  } catch (e) {
    if (e instanceof JournalImportError || e instanceof PostingError || e instanceof Forbidden) return { error: e.message };
    const r = actionError(e);
    return { error: r.error ?? 'Грешка.' };
  }
}

const parse = (payload: string) => {
  try { const p = In.safeParse(JSON.parse(payload)); return p.success ? p.data : null; } catch { return null; }
};

/** Preview: per month, problems, trial balance (nothing is written). */
export async function previewJournalImportAction(payload: string): Promise<R<JiPreview>> {
  const v = parse(payload);
  if (!v) return { error: 'Неважечки податоци.' };
  return run('impRun', (tx, a) => previewJournalImport(tx, a.firmId, { ...v, year: a.year }));
}

/** Import the batch (all journals in one transaction). */
export async function commitJournalImportAction(payload: string): Promise<R<JiResult>> {
  const v = parse(payload);
  if (!v) return { error: 'Неважечки податоци.' };
  const r = await run('impRun', (tx, a) => commitJournalImport(tx, { firmId: a.firmId, userId: a.userId, role: a.role }, { ...v, year: a.year }));
  if (r.data) for (const p of ['/uvoz', '/nalozi', '/partneri', '/bbilans', '/izlez', '/pocetna']) revalidatePath(p);
  return r;
}

/** „🗑 Избриши го увозот“: every journal of the batch (open periods only). */
export async function deleteJournalImportAction(batch: string): Promise<R<number>> {
  const r = await run('nalDel', (tx, a) => deleteJournalImport(tx, { firmId: a.firmId, userId: a.userId }, String(batch)));
  if (r.data != null) for (const p of ['/uvoz', '/nalozi', '/bbilans']) revalidatePath(p);
  return r;
}

/** The old program's „Финансов налог“ PDF → the journal import's grid (headings + one row per record). */
export async function readJournalPdfAction(form: FormData): Promise<{ grid?: string[][]; error?: string }> {
  try {
    await firmAction('impRun');
    const f = form.get('file');
    if (!(f instanceof File)) return { error: 'Изберете датотека.' };
    if (f.size > 40 * 1024 * 1024) return { error: 'Датотеката е преголема (најмногу 40 MB).' };
    const L = pdfLines(await pdfTextItems(new Uint8Array(await f.arrayBuffer()), 1000));
    if (!L.length) return { error: 'PDF-от нема текст (скениран документ) – побарајте Excel од старата програма.' };
    const F = finNalogsFromLines(L);
    if (!F.length) return { error: 'PDF-от не е „Финансов налог“ од старата програма. За друг PDF користете го Конверторот на датотеки.' };
    return { grid: finNalogJournalGrid(F) };
  } catch (e) {
    if (e instanceof Forbidden) return { error: e.message };
    const r = actionError(e);
    return { error: r.error ?? 'PDF-от не може да се отвори.' };
  }
}
