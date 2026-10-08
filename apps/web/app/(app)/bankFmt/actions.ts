'use server';
/** Legacy `VIEWS.bankFmt` file check (`bkAnalyze`, `bkScore`) + `appsettings/bankfmt` (best format seen per bank). */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import {
  analyzeStatements, bankByText, decodeBankBytes, detectStatementFormat, parseBankTable, parseStatementFile, statementScore,
  type Statement, type StatementAnalysis,
} from '@wise/core';
import { appSettings, audit } from '@wise/db';
import { firmAction } from '@/lib/books';
import { db } from '@/lib/db';

export type Analysis = StatementAnalysis & { file: string; score: number };

export async function analyzeFilesAction(form: FormData): Promise<{ error?: string; rows?: Analysis[] }> {
  let u;
  try { ({ u } = await firmAction('write')); } catch (e) { return { error: e instanceof Error ? e.message : 'Немате дозвола.' }; }
  const out: Analysis[] = [];
  for (const f of form.getAll('file').filter((x): x is File => typeof x === 'object' && 'arrayBuffer' in x)) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const kind = detectStatementFormat(bytes, f.name);
      const isBin = /\.(xlsx|pdf|png|jpe?g|webp)$/i.test(f.name);
      const text = isBin ? '' : decodeBankBytes(bytes).slice(0, 20000);
      let S: Statement[] | null = null;
      if (kind === 'excel') {
        const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
        const st = parseBankTable(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: '' }));
        S = st ? [st] : null;
      } else if (kind !== 'ai') S = parseStatementFile(bytes, f.name);
      const A = analyzeStatements(S, kind === 'excel' ? 'table' : kind, bankByText(text.slice(0, 6000)) || bankByText(f.name), text);
      if (kind === 'excel') A.fmt = /\.xls$/i.test(f.name) ? 'Excel (XLS)' : 'Excel (XLSX)';
      out.push({ ...A, file: f.name, score: statementScore(A) });
    } catch {
      out.push({ file: f.name, fmt: 'Грешка при читање', bank: '', no: '', n: 0, names: 0, purp: 0, bal: false, mkd: false, osnov: false, note: '', score: 0 });
    }
  }
  // remember the best format per bank (office-wide)
  const [cur] = await db().select().from(appSettings).where(eq(appSettings.key, 'bankfmt')).limit(1);
  const BF = { ...((cur?.value as Record<string, Record<string, { s: number; at: string }>>) ?? {}) };
  let changed = false;
  for (const r of out) {
    if (!r.bank || !r.n && !r.fmt.startsWith('PDF')) continue;
    const k = r.fmt.replace(/\s*\(.*\)$/, '');
    const prev = BF[r.bank]?.[k];
    if (!prev || r.score > prev.s) { BF[r.bank] = { ...(BF[r.bank] ?? {}), [k]: { s: r.score, at: new Date().toISOString().slice(0, 10) } }; changed = true; }
  }
  if (changed) {
    await db().transaction(async (tx) => {
      await tx.insert(appSettings).values({ key: 'bankfmt', value: BF, updatedBy: u.id }).onConflictDoUpdate({ target: appSettings.key, set: { value: BF, updatedBy: u.id } });
      await audit(tx, { userId: u.id, action: 'bankFmt', entityType: 'app_settings', entityId: 'bankfmt', data: { files: out.map((r) => ({ file: r.file, bank: r.bank, fmt: r.fmt, score: r.score })) } });
    });
    revalidatePath('/bankFmt');
  }
  return { rows: out };
}
