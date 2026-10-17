/**
 * Reading a large batch of statements in the browser (`ai-batch.ts`): progress „Прочитани N / M (K грешки)“, a file
 * in error listed and skipped, no fixed time limit while reads finish, „Продолжи со прочитаните“, and a file read
 * before is not read again (the server gives the earlier read back).
 */
import { describe, expect, it } from 'vitest';
import { IDLE_MS, POLL_MS, progressText, readBatch, type BatchDeps } from './ai-batch';

/** A fake server: files by content, one read per content (reuse), each read finishing after `ticks` polls. */
function server(o: { ticks?: (name: string) => number; fail?: (name: string) => string | null; uploadFail?: (name: string) => string | null } = {}) {
  const fileOf = new Map<string, string>(); // content → file id
  const readOf = new Map<string, string>(); // file id → read id
  const reads = new Map<string, { name: string; left: number; error: string | null }>();
  let clock = 0;
  const deps: BatchDeps = {
    upload: async (f) => {
      const e = o.uploadFail?.(f.name);
      if (e) return { ok: false, error: e };
      const key = await f.text();
      if (!fileOf.has(key)) fileOf.set(key, `file-${fileOf.size + 1}`);
      return { ok: true, id: fileOf.get(key)! };
    },
    start: async (fileIds) => {
      let reused = 0;
      const ids = fileIds.map((fid) => {
        if (readOf.has(fid)) { reused++; return readOf.get(fid)!; }
        const id = `read-${reads.size + 1}`;
        const name = [...fileOf.entries()].find(([, v]) => v === fid)![0];
        reads.set(id, { name, left: o.ticks?.(name) ?? 1, error: o.fail?.(name) ?? null });
        readOf.set(fid, id);
        return id;
      });
      return { ids, reused };
    },
    status: async (ids) => ids.map((id) => {
      const r = reads.get(id)!;
      if (r.left > 0) { r.left--; return { id, status: 'reading', error: null }; }
      return { id, status: r.error ? 'error' : 'done', error: r.error };
    }),
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  };
  return { deps, reads, clock: () => clock };
}
const pdf = (name: string, content = name) => new File([content], name, { type: 'application/pdf' });
const isPdf = (f: File) => /\.pdf$/i.test(f.name);

describe('large batch of statement reads', () => {
  it('144 files: progress, one error listed and skipped, the rest read', async () => {
    const S = server({ ticks: (n) => (n.endsWith('7.pdf') ? 3 : 1), fail: (n) => (n === 'DpsStatement13.pdf' ? 'PDF без текст и AI не е достапен.' : null) });
    const L = Array.from({ length: 144 }, (_, i) => pdf(`DpsStatement${i}.pdf`));
    const seen: string[] = [];
    const r = await readBatch(L, isPdf, S.deps, { progress: (p) => seen.push(progressText(p)) });
    expect(r.errors).toEqual([{ i: 13, name: 'DpsStatement13.pdf', error: 'PDF без текст и AI не е достапен.' }]);
    expect(r.done.filter(Boolean)).toHaveLength(143);
    expect(r.ids[13]).toBe('');
    expect(r.waiting).toBe(0);
    expect(seen).toContain('Се прикачуваат датотеките… 144 / 144');
    expect(seen.at(-1)).toBe('Прочитани 143 / 144 (1 грешка)');
    expect(progressText({ total: 144, uploaded: 144, read: 117, errors: 2, phase: 'read' })).toBe('Прочитани 117 / 144 (2 грешки)');
  });

  it('no fixed 5-minute limit: reads that take 20 minutes are waited for while they finish', async () => {
    const perTick = Math.ceil((20 * 60_000) / POLL_MS);
    // one file finishes every few polls, the last after ~20 minutes: never 15 minutes without progress
    const S = server({ ticks: (n) => Math.round((Number(/\d+/.exec(n)![0]) + 1) * (perTick / 10)) });
    const L = Array.from({ length: 10 }, (_, i) => pdf(`f${i}.pdf`));
    const r = await readBatch(L, isPdf, S.deps);
    expect(r.done.every(Boolean)).toBe(true);
    expect(S.clock()).toBeGreaterThan(19 * 60_000);
  });

  it('nothing finishes for a long time: the wait stops, the rest stays reading on the server (not lost, not an error)', async () => {
    const S = server({ ticks: (n) => (n === 'slow.pdf' ? 1e9 : 1) });
    const r = await readBatch([pdf('a.pdf'), pdf('slow.pdf')], isPdf, S.deps);
    expect(r.done).toEqual([true, false]);
    expect(r.ids).toEqual(['read-1', '']);
    expect(r.waiting).toBe(1);
    expect(r.errors).toEqual([]);
    expect(S.clock()).toBeGreaterThanOrEqual(IDLE_MS);
  });

  it('„Продолжи со прочитаните“: the read ones go on to the preview at once', async () => {
    const S = server({ ticks: (n) => (n === 'b.pdf' ? 1000 : 0) });
    let polls = 0;
    const r = await readBatch([pdf('a.pdf'), pdf('b.pdf')], isPdf, { ...S.deps, status: async (ids) => { polls++; return S.deps.status(ids); } }, { stop: () => polls >= 2 });
    expect(r.done).toEqual([true, false]);
    expect(r.waiting).toBe(1);
  });

  it('the same files dropped again: the earlier reads are given back, no new read', async () => {
    const S = server();
    const L = [pdf('x.pdf', 'X'), pdf('y.pdf', 'Y')];
    const a = await readBatch(L, isPdf, S.deps);
    expect(a.reused).toBe(0);
    const b = await readBatch([pdf('x (1).pdf', 'X'), pdf('y.pdf', 'Y')], isPdf, S.deps);
    expect(b.reused).toBe(2);
    expect(b.ids).toEqual(a.ids);
    expect(S.reads.size).toBe(2);
  });

  it('an upload that fails is listed; files that are not PDF / images are not read here', async () => {
    const S = server({ uploadFail: (n) => (n === 'big.pdf' ? 'Датотеката е преголема.' : null) });
    const r = await readBatch([pdf('big.pdf'), new File(['<x/>'], 'izvod.xml'), pdf('ok.pdf')], isPdf, S.deps);
    expect(r.errors).toEqual([{ i: 0, name: 'big.pdf', error: 'Датотеката е преголема.' }]);
    expect(r.ids[1]).toBe('');
    expect(r.done).toEqual([false, false, true]);
  });
});
