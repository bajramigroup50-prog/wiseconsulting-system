/**
 * Архива на документи — files attached to nothing („Датотека“): 🗑 delete (`del` on the firm) and ⇄ move to another
 * firm (`write` on both), refusals for files in use (linked, bank statement, firm logo), other firms' files and
 * duplicates; the archive rows show imported statement files as „Извод“, not as loose files.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
const removed: string[] = [];
vi.mock('@/lib/storage', async (orig) => ({ ...(await orig<object>()), deleteObject: async (k: string) => { removed.push(k); return true; } }));

const { arFileDel, arFileMove } = await import('@/app/(app)/arhiva/actions');
const { archRows } = await import('@/lib/archive');

let A = '', B = '', C = '';
let n = 0;
async function file(firm: string, name = `f${++n}.pdf`, sha = `sha-${n}-${Math.random()}`) {
  const [f] = await pg.insert(schema.files).values({ firmId: firm, bucketKey: `firms/${firm}/2026/${name}-${Math.random()}`, name, mime: 'application/pdf', size: 10, sha256: sha, status: 'ready' }).returning();
  return f!;
}
const get = async (id: string) => (await pg.select().from(schema.files).where(eq(schema.files.id, id)))[0];
const audits = (action: string, id: string) => pg.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.entityId, id)));

beforeAll(async () => {
  await setupDb();
  const F = await pg.insert(schema.firms).values([{ name: 'ПОГРЕШНА ДООЕЛ', settings: {} }, { name: 'ВИСТИНСКА ДОО', settings: {} }, { name: 'ТУЃА ДОО', settings: {} }]).returning();
  [A, B, C] = F.map((f) => f.id) as [string, string, string];
});
beforeEach(() => { removed.length = 0; useFirm(A); });

describe('🗑 delete a loose file', () => {
  it('needs `del` on the firm (an accountant has none)', async () => {
    const f = await file(A);
    await signIn('acc', { firms: [A, B] });
    const r = await arFileDel([f.id]);
    expect(r.error).toMatch(/дозвола/);
    expect(await get(f.id)).toBeTruthy();
  });

  it('admin deletes: row, unsaved AI reads, stored object, audit', async () => {
    const f = await file(A, 'izvod-pogresno.pdf');
    await pg.insert(schema.aiDocuments).values({ firmId: A, fileId: f.id, kind: 'bank', status: 'error', error: 'нечитливо' });
    await signIn('admin');
    const r = await arFileDel([f.id]);
    expect(r.ok).toMatch(/Избришани 1/);
    expect(await get(f.id)).toBeUndefined();
    expect(await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.fileId, f.id))).toHaveLength(0);
    expect(removed).toEqual([f.bucketKey]);
    const [a] = await audits('fileDelete', f.id);
    expect(a).toMatchObject({ firmId: A, entityType: 'file' });
    expect((a!.data as { name: string }).name).toBe('izvod-pogresno.pdf');
  });

  it('refuses files in use and files of another firm; bulk deletes the rest', async () => {
    const linked = await file(A);
    await pg.insert(schema.fileLinks).values({ fileId: linked.id, entityType: 'purchase', entityId: 'x' });
    const logo = await file(A, 'logo.png');
    await pg.update(schema.firms).set({ settings: { logo: logo.id } }).where(eq(schema.firms.id, A));
    const [acct] = await pg.insert(schema.bankAccounts).values({ firmId: A, name: 'Стопанска', konto: '1000' }).returning();
    const stmt = await file(A, 'izvod-1.pdf');
    await pg.insert(schema.bankStatements).values({ firmId: A, bankAccountId: acct!.id, date: '2026-03-02', number: '12', fileId: stmt.id });
    const saved = await file(A);
    await pg.insert(schema.aiDocuments).values({ firmId: A, fileId: saved.id, kind: 'purchase', status: 'saved' });
    const foreign = await file(C);
    const loose = await file(A);
    await signIn('admin');
    const r = await arFileDel([linked.id, logo.id, stmt.id, saved.id, foreign.id, loose.id]);
    expect(r.ok).toMatch(/Избришани 1 датотека/);
    expect(r.ok).toMatch(/Прескокнати \(4\)/);
    expect(r.ok).toMatch(/лого/);
    expect(r.ok).toMatch(/извод/);
    for (const f of [linked, logo, stmt, saved, foreign]) expect(await get(f.id)).toBeTruthy();
    expect(await get(loose.id)).toBeUndefined();
    expect(removed).toEqual([loose.bucketKey]);
    expect((await arFileDel([foreign.id])).error).toMatch(/не е пронајдена/);
  });
});

describe('⇄ move a loose file to another firm', () => {
  it('moves into an assigned firm with `write`, audit in both firms', async () => {
    const f = await file(A, 'izvod-za-B.pdf');
    await pg.insert(schema.aiDocuments).values({ firmId: A, fileId: f.id, kind: 'bank', status: 'done' });
    await signIn('acc', { firms: [A, B] });
    const r = await arFileMove([f.id], B);
    expect(r.ok).toMatch(/Преместени 1 датотека во „ВИСТИНСКА ДОО“/);
    expect((await get(f.id))!.firmId).toBe(B);
    expect(await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.fileId, f.id))).toHaveLength(0);
    expect((await audits('fileMove', f.id)).map((a) => a.firmId).sort()).toEqual([A, B].sort());
    expect(removed).toEqual([]);
  });

  it('refuses a firm the user has no access to, a view-only user, the same firm and a duplicate in the target', async () => {
    const f = await file(A);
    await signIn('acc', { firms: [A, B] });
    expect((await arFileMove([f.id], C)).error).toMatch(/дозвола/);
    expect((await arFileMove([f.id], A)).error).toMatch(/веќе во оваа фирма/);
    const twin = await file(A, 'twin.pdf', 'same-sha');
    await file(B, 'twin.pdf', 'same-sha');
    const r = await arFileMove([twin.id], B);
    expect(r.error).toMatch(/веќе постои во „ВИСТИНСКА ДОО“/);
    expect((await get(twin.id))!.firmId).toBe(A);
    await signIn('view', { firms: [A, B] });
    expect((await arFileMove([f.id], B)).error).toMatch(/дозвола/);
    await signIn('acc', { firms: [A] });
    expect((await arFileMove([f.id], B)).error).toMatch(/дозвола/);
    expect((await get(f.id))!.firmId).toBe(A);
  });

  it('a file attached to a document stays', async () => {
    const f = await file(A);
    await pg.insert(schema.fileLinks).values({ fileId: f.id, entityType: 'invoice', entityId: 'y' });
    await signIn('admin');
    expect((await arFileMove([f.id], B)).error).toMatch(/Ништо не е преместено.*прикачена на документ/);
  });
});

describe('archive rows', () => {
  it('statement files are „Извод“ rows, the logo its own row, only unattached files are loose', async () => {
    const [acct] = await pg.insert(schema.bankAccounts).values({ firmId: B, name: 'Халк', account: '270000000000001', konto: '1000' }).returning();
    const st = await file(B, 'izvod-5.pdf');
    await pg.insert(schema.bankStatements).values({ firmId: B, bankAccountId: acct!.id, date: '2026-04-30', number: '5', fileId: st.id });
    const logo = await file(B, 'logo-b.png');
    await pg.update(schema.firms).set({ settings: { logo: logo.id } }).where(eq(schema.firms.id, B));
    const loose = await file(B, 'nepoznato.pdf');
    const R = await archRows(B);
    const row = (id: string) => R.find((r) => r.files.some((x) => x.id === id));
    expect(row(st.id)).toMatchObject({ kind: 'Извод', no: '5', pn: 'Халк · 270000000000001', href: `/banka?acct=${acct!.id}&m=04` });
    expect(row(st.id)!.loose).toBeUndefined();
    expect(row(logo.id)).toMatchObject({ kind: 'Лого / потпис / печат' });
    expect(row(loose.id)).toMatchObject({ kind: 'Датотека', loose: true, key: `file:${loose.id}` });
  });
});
