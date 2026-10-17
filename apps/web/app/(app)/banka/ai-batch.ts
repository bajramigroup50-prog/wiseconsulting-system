/**
 * Reading many statement files at once (the owner drops 144 НЛБ PDFs into the import box): upload → start the reads
 * (a file read before is not read again, `startAiRead({ reuse })`) → wait for them with progress
 * („Прочитани 117 / 144 (1 грешка)“). There is no fixed time limit: the wait goes on while reads finish, and stops
 * only when nothing has changed for a long time or the user continues with what is read. A file that fails is
 * listed with its reason and left out; it never fails the others. Reads still running when the wait stops stay on
 * the server and come back later as „Прочитани изводи што чекаат увоз“.
 *
 * Pure (the upload, the server actions and the clock are passed in) so the flow is tested without a browser.
 */

export interface BatchDeps {
  upload: (f: File) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  start: (fileIds: string[]) => Promise<{ ids?: string[]; reused?: number; error?: string }>;
  status: (ids: string[]) => Promise<{ id: string; status: string; error: string | null }[]>;
  sleep: (ms: number) => Promise<void>;
  /** Clock (ms), for the idle limit. */
  now?: () => number;
}

export interface BatchProgress {
  total: number;
  /** Uploaded so far (phase `upload`). */
  uploaded: number;
  read: number;
  errors: number;
  phase: 'upload' | 'read' | 'done';
}

export interface BatchError { i: number; name: string; error: string }

export interface BatchResult {
  /** Read id per file ('' = not read: not an AI file, failed or still reading). */
  ids: string[];
  /** Files with a finished read. */
  done: boolean[];
  errors: BatchError[];
  /** Files whose read was still running when the wait stopped. */
  waiting: number;
  /** Reads given back from an earlier read of the same file (no new read). */
  reused: number;
}

/** „Прочитани 117 / 144 (1 грешка)“. */
export function progressText(p: BatchProgress): string {
  if (p.phase === 'upload') return `Се прикачуваат датотеките… ${p.uploaded} / ${p.total}`;
  const e = p.errors ? ` (${p.errors} ${p.errors % 10 === 1 && p.errors % 100 !== 11 ? 'грешка' : 'грешки'})` : '';
  return `Прочитани ${p.read} / ${p.total}${e}`;
}

/** Ids per server call (the actions take at most 100). */
const CHUNK = 100;
const chunks = <T>(L: readonly T[], n = CHUNK): T[][] => Array.from({ length: Math.ceil(L.length / n) }, (_, i) => L.slice(i * n, i * n + n));

export const POLL_MS = 2500;
/** The wait stops when no read has finished (or failed) for this long — the rest stays pending on the server. */
export const IDLE_MS = 15 * 60_000;

/**
 * Read the files `take(f)` selects (the others get ''). `stop()` = the user continues with what is read; `progress`
 * is called on every change.
 */
export async function readBatch(L: readonly File[], take: (f: File) => boolean, deps: BatchDeps, o: { progress?: (p: BatchProgress) => void; stop?: () => boolean; idleMs?: number; prep?: (f: File) => Promise<File> } = {}): Promise<BatchResult> {
  const now = deps.now ?? (() => Date.now());
  const ids = L.map(() => '');
  const done = L.map(() => false);
  const errors: BatchError[] = [];
  const idx = L.map((f, i) => (take(f) ? i : -1)).filter((i) => i >= 0);
  const total = idx.length;
  const P: BatchProgress = { total, uploaded: 0, read: 0, errors: 0, phase: 'upload' };
  const tell = () => o.progress?.({ ...P });
  const fail = (i: number, error: string) => { errors.push({ i, name: L[i]!.name, error }); P.errors = errors.length; };
  if (!total) return { ids, done, errors, waiting: 0, reused: 0 };
  tell();
  // 1. upload (a file the firm already has is not sent again: the server answers with the stored one by sha256)
  const up: { i: number; fileId: string }[] = [];
  for (const i of idx) {
    try {
      const f = o.prep ? await o.prep(L[i]!) : L[i]!;
      const r = await deps.upload(f);
      if (r.ok) up.push({ i, fileId: r.id }); else fail(i, r.error);
    } catch (e) { fail(i, e instanceof Error ? e.message : 'Грешка при прикачување.'); }
    P.uploaded++;
    tell();
  }
  // 2. start the reads (earlier reads of the same content are given back)
  let reused = 0;
  const reads: { i: number; id: string }[] = [];
  for (const C of chunks(up)) {
    const s = await deps.start(C.map((x) => x.fileId));
    if (s.error || !s.ids) { for (const x of C) fail(x.i, s.error ?? 'Читањето не е започнато.'); continue; }
    reused += s.reused ?? 0;
    s.ids.forEach((id, k) => { ids[C[k]!.i] = id; reads.push({ i: C[k]!.i, id }); });
  }
  P.phase = 'read';
  tell();
  // 3. wait: no fixed limit while reads finish; per-file errors are listed, the others go on
  const open = new Map(reads.map((r) => [r.id, r]));
  let last = now();
  const idle = o.idleMs ?? IDLE_MS;
  for (let first = true; open.size; first = false) {
    if (!first) {
      if (o.stop?.()) break;
      if (now() - last > idle) break;
      await deps.sleep(POLL_MS);
      if (o.stop?.()) break;
    }
    let changed = false;
    for (const C of chunks([...open.keys()])) {
      let S: Awaited<ReturnType<BatchDeps['status']>>;
      try { S = await deps.status(C); } catch { continue; }
      for (const x of S) {
        const r = open.get(x.id);
        if (!r) continue;
        if (x.status === 'done' || x.status === 'saved') { done[r.i] = true; P.read++; open.delete(x.id); changed = true; }
        else if (x.status === 'error') { ids[r.i] = ''; fail(r.i, x.error || 'Изводот не е прочитан.'); open.delete(x.id); changed = true; }
      }
    }
    if (changed) { last = now(); tell(); }
  }
  // what is still reading keeps its id out of this preview (it comes back in the waiting list when done)
  for (const r of open.values()) ids[r.i] = '';
  P.phase = 'done';
  tell();
  return { ids, done, errors: errors.sort((a, b) => a.i - b.i), waiting: open.size, reused };
}
