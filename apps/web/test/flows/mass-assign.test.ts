/**
 * „Масовно доделување“ of Излез (like the old program): the ticked invoices get the same комитент, датум / валута and
 * налог at once; empty fields are not changed; nothing ticked or nothing filled is refused (PGlite).
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { form, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const H = await import('@/app/(app)/izlez/head-actions');
const M = await import('@/app/(app)/izlez/mass-assign');
let c1 = '', c2 = '';
const ids: string[] = [];
const inv = async (id: string) => (await pg.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0]!;
const head = (o: Record<string, string>) => form({
  number: '', nalogNo: '', oe: '', partnerId: c1, refDoc: '', archNo: '', date: '2026-11-21', days: '', due: '', procDate: '2026-11-21', scheme: '',
  currency: 'MKD', fx: '1', advPaid: '', payMethod: '', saldo: 'Н', tip: 'final', note1: '', note2: '', note3: '', workOrder: '', attachNote: '', descr: '',
  grp1: '', grp2: '', costType: '', finNote: '', ...o,
});

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'Масовно ДООЕЛ', edb: '4030000000555', vatRegistered: true }).returning();
  const [a] = await pg.insert(schema.partners).values({ firmId: f!.id, name: 'ПРВ КУПУВАЧ', code: '0001' }).returning();
  const [b] = await pg.insert(schema.partners).values({ firmId: f!.id, name: 'ВТОР КУПУВАЧ', code: '0002' }).returning();
  c1 = a!.id; c2 = b!.id;
  await signIn('admin');
  useFirm(f!.id); useYear(2026);
  for (const n of ['1', '2']) ids.push((await H.saveInvoiceHeadAction({}, head({ number: 'М-' + n })))!.id!);
});

describe('„Масовно доделување“ (Излез)', () => {
  it('refuses nothing ticked / nothing filled', async () => {
    expect((await M.massAssignAction('invoice', [], { partnerId: c2 })).error).toMatch(/Штиклирајте/);
    expect((await M.massAssignAction('invoice', ids, { partnerId: '', date: '' })).error).toMatch(/барем едно поле/);
  });

  it('комитент, датум / валута and налог go to every ticked invoice; the rest stays', async () => {
    const r1 = await M.massAssignAction('invoice', ids, { partnerId: c2 });
    expect(r1.n).toBe(2);
    const r2 = await M.massAssignAction('invoice', ids, { date: '2026-11-20', due: '2026-12-20' });
    expect(r2.n).toBe(2);
    const r3 = await M.massAssignAction('invoice', ids, { nalogNo: '777' });
    expect(r3.n).toBe(2);
    for (const id of ids) {
      const i = await inv(id);
      expect(i).toMatchObject({ partnerId: c2, date: '2026-11-20', due: '2026-12-20' });
      expect((i.data as { nalogNo?: string }).nalogNo).toBe('777');
      expect(i.number).toMatch(/^М-/);
    }
  });
});
