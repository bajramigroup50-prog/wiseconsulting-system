/**
 * `legacy.import` — import backups of the old program (Систем › 📥 Увоз од старата програма).
 *
 * The page uploads the backup files (ZIP / JSON) to the object store and creates a `legacy_import_runs` row; this job
 * reads the files, parses them (`@wise/legacy-import`), imports every firm in its own transaction and writes progress
 * and the per-firm report back to the run row.
 */
import { eq, inArray } from 'drizzle-orm';
import { files, legacyImportRuns, type DB, type LegacyImportProgress, type Tx } from '@wise/db';
import { BackupFormatError, importBundle, mergeBundles, parseBackupFile, type LegacyBundle } from '@wise/legacy-import';
import { defineJob } from '../job';
import { readS3File } from '../mail/files';
import { s3Store, type ObjectStore } from '../storage';

export interface LegacyImportData { runId: string }

export interface LegacyImportDeps {
  read?: (bucketKey: string) => Promise<Uint8Array>;
  store?: ObjectStore;
  /** Write progress inside a firm (needs a second connection; off for single-connection test databases). */
  liveProgress?: boolean;
}

export async function runLegacyImport(db: DB, runId: string, deps: LegacyImportDeps = {}, log: (m: string) => void = () => {}): Promise<void> {
  const [run] = await db.select().from(legacyImportRuns).where(eq(legacyImportRuns.id, runId)).limit(1);
  if (!run) throw new Error(`legacy.import: run ${runId} not found`);
  if (run.status !== 'queued') { log(`run ${runId} is ${run.status} – skipped`); return; }
  await db.update(legacyImportRuns).set({ status: 'running', startedAt: new Date(), error: null }).where(eq(legacyImportRuns.id, runId));
  const progress: LegacyImportProgress = { done: 0, total: 0, step: 'читање на датотеките' };
  const save = (p: Partial<LegacyImportProgress>) => db.update(legacyImportRuns).set({ progress: Object.assign(progress, p) }).where(eq(legacyImportRuns.id, runId));
  await save({});
  try {
    const ids = run.files.map((f) => f.id);
    const rows = ids.length ? await db.select().from(files).where(inArray(files.id, ids)) : [];
    const parseErrors: string[] = [];
    const bundles: LegacyBundle[] = [];
    const read = deps.read ?? (async (k: string) => new Uint8Array(await readS3File(k)));
    for (const f of run.files) {
      const row = rows.find((r) => r.id === f.id);
      if (!row) { parseErrors.push(`${f.name}: датотеката не е најдена.`); continue; }
      try {
        bundles.push(parseBackupFile(row.name, await read(row.bucketKey)));
      } catch (e) {
        parseErrors.push(e instanceof BackupFormatError ? e.message : `${row.name}: ${(e as Error).message}`);
      }
    }
    const bundle = mergeBundles(bundles);
    const only = Array.isArray(run.options.onlyFirms) ? new Set((run.options.onlyFirms as unknown[]).map(String)) : null;
    if (only?.size) bundle.firms = bundle.firms.filter((f) => only.has(f.firm.id));
    if (run.options.users === false) bundle.users = [];
    await save({ total: bundle.firms.length, step: 'увоз' });
    let last = 0;
    const report = await importBundle(db as unknown as Tx, bundle, {
      userId: run.createdBy, runId, files: deps.store ?? s3Store,
      vatBaseLines: run.options.vatBaseLines !== false,
      onFirmStart: async (name, i, n) => { log(`${i + 1}/${n} ${name}`); await save({ done: i, total: n, firm: name, step: 'почеток' }); },
      onFirm: async (r, i, n) => { await save({ done: i + 1, total: n, step: r.status === 'failed' ? 'неуспешно' : 'готово' }); },
      progress: deps.liveProgress === false ? undefined : async (step) => {
        if (Date.now() - last < 1500) return;
        last = Date.now();
        await save({ step });
      },
    });
    const failed = report.firms.filter((f) => f.status === 'failed').length;
    await db.update(legacyImportRuns).set({
      status: 'done', finishedAt: new Date(), report: { ...report, parseErrors } as unknown as Record<string, unknown>,
      progress: { ...progress, done: report.firms.length, step: failed ? `готово (${failed} неуспешни)` : 'готово' },
    }).where(eq(legacyImportRuns.id, runId));
    log(`done: ${report.firms.length} firms, ${failed} failed`);
  } catch (e) {
    await db.update(legacyImportRuns).set({ status: 'failed', finishedAt: new Date(), error: (e as Error).message ?? String(e) }).where(eq(legacyImportRuns.id, runId));
    throw e;
  }
}

export const legacyImport = defineJob<LegacyImportData>({
  name: 'legacy.import',
  async run(data, { db, log }) {
    await runLegacyImport(db, data.runId, {}, log);
  },
});
