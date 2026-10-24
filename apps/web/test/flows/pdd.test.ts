/**
 * ПДД (/pdd): the УЈП „Аконтативна пресметка“ import is refused when the amounts by the chosen „Вид“ differ from the
 * PDF's; „🔗 Поврзи / прекнижи“ re-books only payments whose partner changed (or whose lines lack it) and goes on past
 * a payment that cannot be re-booked, reporting each.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { act, form, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@/lib/jobs', () => ({ recheckFirmLater: async () => {} }));
vi.mock('@/lib/pdf-text', () => ({ pdfTextItems: async () => [] }));
const PDF = vi.hoisted(() => ({ cur: null as unknown }));
vi.mock('@wise/core/pdd-akont', () => ({ parseAkontativna: () => PDF.cur }));

const { importAkontAction, relinkPddAction } = await import('@/app/(app)/pdd/actions');

let firmId = '';
const pdf = () => new File([new Uint8Array([1])], 'ak.pdf', { type: 'application/pdf' });
const payments = () => pg.select().from(schema.pddPayments).where(eq(schema.pddPayments.firmId, firmId));

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'ПДД ДООЕЛ' }).returning();
  firmId = f!.id;
  await signIn('admin');
  useFirm(firmId);
  useYear(2026);
}, 120_000);

describe('ПДД import from the УЈП PDF', () => {
  const row = { embg: '0101990450001', name: 'ПЕТАР ПЕТРОВ', acct: '', code: 'S6.1', vid: 'T6. Доход од закуп и подзакуп', pod: 'S6.1. Доход од закуп', gross: 10_000, ded: 1_000, tax: 900, net: 9_100 };
  it('refuses a calculation whose tax / net differ from the PDF by the chosen „Вид“', async () => {
    PDF.cur = { number: '11', date: '2026-05-10', payDate: '', edb: '', rows: [row] };
    const r = await act(importAkontAction({}, form({ pdf: pdf(), tid: 's1_15' })));
    expect('error' in r && r.error).toMatch(/ПЕТАР ПЕТРОВ: .*ПДД 1\.000 \/ нето 9\.000, во PDF ПДД 900 \/ нето 9\.100.*точниот „Вид“/);
    expect(await payments()).toHaveLength(0);
  });
  it('imports it with the type of its income code (amounts agree)', async () => {
    const r = await act(importAkontAction({}, form({ pdf: pdf() })));
    expect(r).toMatchObject({ redirect: expect.stringMatching(/^\/pdd\?ed=/) });
    const [p] = await payments();
    expect([p!.tax, p!.net]).toEqual(['900.00', '9100.00']);
  });
});

describe('„🔗 Поврзи / прекнижи“', () => {
  it('re-books only what changed and reports every payment that fails', async () => {
    await pg.delete(schema.pddPayments).where(eq(schema.pddPayments.firmId, firmId));
    await pg.insert(schema.partners).values([{ firmId, name: 'АНА АНОВА' }, { firmId, name: 'БОРИС БОРИСОВ' }]);
    // older payments: recipients without a partner (both exist by name)
    for (const [date, name] of [['2026-02-10', 'АНА АНОВА'], ['2026-06-10', 'БОРИС БОРИСОВ']] as const) {
      await pg.insert(schema.pddPayments).values({ firmId, date, note: name, rows: [{ tid: 's1_15', mode: 'g', amt: 1_000, name, embg: '', acct: '', pid: null, G: 1_000, ded: 0, tax: 100, net: 900 }], gross: '1000', deductions: '0', tax: '100', net: '900' });
    }
    await pg.update(schema.firms).set({ lockDate: '2026-03-31' }).where(eq(schema.firms.id, firmId));
    const r1 = await relinkPddAction({}, form({}));
    expect(r1.error).toMatch(/^Прекнижени 1 пресметки.*Не се прекнижани 1: 10\.02\.2026 АНА АНОВА: /);
    // nothing changed: June is not re-booked again, February still reported
    const r2 = await relinkPddAction({}, form({}));
    expect(r2.error).toMatch(/^Прекнижени 0 пресметки.*Не се прекнижани 1:/);
    await pg.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
    expect((await relinkPddAction({}, form({}))).ok).toMatch(/^Прекнижени 1 пресметки/);
    expect((await relinkPddAction({}, form({}))).ok).toMatch(/^Прекнижени 0 пресметки/);
    // an older booking without the person on its lines is re-booked
    const [j] = await pg.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, 'pdd'), eq(schema.journals.date, '2026-06-10')));
    await pg.update(schema.journalLines).set({ partnerId: null }).where(eq(schema.journalLines.journalId, j!.id));
    expect((await relinkPddAction({}, form({}))).ok).toMatch(/^Прекнижени 1 пресметки/);
    expect(await pg.select().from(schema.journalLines).where(and(eq(schema.journalLines.journalId, j!.id), eq(schema.journalLines.account, '22055'), isNull(schema.journalLines.partnerId)))).toHaveLength(0);
  });
});
