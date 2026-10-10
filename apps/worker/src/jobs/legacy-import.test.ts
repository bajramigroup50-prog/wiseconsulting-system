import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { files, firms, legacyImportRuns, type DB } from '@wise/db';
import { testDb } from '@wise/legacy-import/testing';
import { runLegacyImport } from './legacy-import';

let db: DB;
const objects = new Map<string, Uint8Array>();
const enc = new TextEncoder();

const backup = {
  v: 1, at: '2026-10-01T00:00:00Z',
  firm: { id: 'wf1', name: 'ВОРКЕР ДООЕЛ', edb: '4030999000099', ddv: true },
  data: {
    partners: [{ id: 'p1', code: '1', name: 'Купувач' }],
    invoices: [{ id: 'i1', number: '1', date: '2026-04-02', partner: 'p1', items: [{ name: 'Услуга', qty: 1, price: 100, rate: 18, konto: '7400' }], lines: [{ k: '1200', d: 118, p: 0 }, { k: '7400', d: 0, p: 100 }, { k: '230018', d: 0, p: 18 }] }],
  },
};

async function upload(name: string, body: Uint8Array): Promise<string> {
  const key = `office/2026/${name}`;
  objects.set(key, body);
  const [f] = await db.insert(files).values({ firmId: null, bucketKey: key, name, mime: 'application/json', size: body.length, sha256: name.padEnd(64, '0').slice(0, 64), status: 'ready' }).returning({ id: files.id });
  return f!.id;
}

beforeAll(async () => { db = (await testDb()) as unknown as DB; }, 120_000);

describe('legacy.import job', () => {
  it('parses the uploaded files, imports the firms and stores the report', async () => {
    const good = await upload('Rezervna_kopija_WORKER_wf1.json', enc.encode(JSON.stringify(backup)));
    const bad = await upload('nesto.json', enc.encode('{"x":1}'));
    const [run] = await db.insert(legacyImportRuns).values({ files: [{ id: good, name: 'a.json', size: 1 }, { id: bad, name: 'nesto.json', size: 1 }] }).returning();
    await runLegacyImport(db, run!.id, { read: async (k) => objects.get(k)!, store: { put: async () => {} }, liveProgress: false });
    const [r] = await db.select().from(legacyImportRuns).where(eq(legacyImportRuns.id, run!.id));
    expect(r!.status).toBe('done');
    expect(r!.progress).toMatchObject({ done: 1, total: 1 });
    const rep = r!.report as { firms: { status: string; trialBalance: { ok: boolean } }[]; parseErrors: string[] };
    expect(rep.firms[0]).toMatchObject({ status: 'created', trialBalance: { ok: true } });
    expect(rep.parseErrors[0]).toMatch(/не е резервна копија/);
    expect((await db.select().from(firms).where(eq(firms.legacyId, 'wf1')))).toHaveLength(1);
    // a finished run is not run twice
    await runLegacyImport(db, run!.id, { read: async (k) => objects.get(k)!, liveProgress: false });
    expect((await db.select().from(legacyImportRuns).where(eq(legacyImportRuns.id, run!.id)))[0]!.finishedAt).toEqual(r!.finishedAt);
  });
});
