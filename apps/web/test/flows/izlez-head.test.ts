/**
 * Материјално › Излез like the old program (Helix): „Нов (Ins)“ → „Нова услужна калкулација“ opens the header of an
 * invoice (a draft without lines, its lines then in the editor); „Промена (Ent)“ changes the header of a booked
 * invoice and keeps its lines, journal and number; F5 = the next number; a production invoice is changed in the
 * invoice itself (PGlite).
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { act, form, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const H = await import('@/app/(app)/izlez/head-actions');
const { saveInvoiceAction } = await import('@/app/(app)/izlez/actions');
let firmId = '', cust = '';
const inv = async (id: string) => (await pg.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0]!;
const head = (o: Record<string, string>) => form({
  number: '', nalogNo: '', oe: '', partnerId: cust, refDoc: '', archNo: '', date: '2026-11-21', days: '', due: '', procDate: '2026-11-21', scheme: '',
  currency: 'MKD', fx: '1', advPaid: '', payMethod: 'Вирман', saldo: 'Н', tip: 'final', note1: '', note2: '', note3: '', workOrder: '', attachNote: '', descr: '',
  grp1: '', grp2: '', costType: '', finNote: '', ...o,
});

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'Услужни Калкулации ДООЕЛ', edb: '4030000000123', vatRegistered: true }).returning();
  firmId = f!.id;
  const [p] = await pg.insert(schema.partners).values({ firmId, name: 'КУПУВАЧ ДОО', code: '0007' }).returning();
  cust = p!.id;
  await signIn('admin');
  useFirm(firmId); useYear(2026);
});

describe('„Нова услужна калкулација“ (Излез)', () => {
  it('F5 gives the next invoice number', async () => {
    expect((await H.nextInvoiceNumberAction('2026-11-21')).no).toBeTruthy();
    expect((await H.nextInvoiceNumberAction('x')).error).toBeTruthy();
  });

  it('„Во ред (F9)“ without a комитент is refused', async () => {
    expect((await H.saveInvoiceHeadAction({}, head({ partnerId: '' }))).error).toMatch(/комитент/);
  });

  let id = '';
  it('opens a draft with the header: due = датум + денови, three-line note, Helix fields in `data`', async () => {
    const r = await H.saveInvoiceHeadAction({}, head({
      days: '15', oe: '01', refDoc: 'НАР-5', archNo: 'А-77', note1: 'ред 1', note2: 'ред 2', saldo: 'Д', workOrder: 'РН-3', attachNote: 'договор',
      grp1: 'Г1', grp2: 'Г2', costType: 'Услуга', finNote: 'само финансово', advPaid: '500', payMethod: 'Готовина', descr: 'опис на работата',
    }));
    expect(r.ok).toMatch(/Отворена/);
    id = r.id!;
    const i = await inv(id);
    expect(i).toMatchObject({ kind: 'invoice', status: 'draft', partnerId: cust, date: '2026-11-21', due: '2026-12-06', note: 'ред 1\nред 2', advance: false, art32: false, svc: false });
    expect(i.data).toMatchObject({ oe: '01', refDoc: 'НАР-5', archNo: 'А-77', days: '15', saldo: 'Д', workOrder: 'РН-3', attachNote: 'договор', grp1: 'Г1', grp2: 'Г2',
      costType: 'Услуга', finNote: 'само финансово', advPaid: '500', payMethod: 'Готовина', descr: 'опис на работата', procDate: '2026-11-21' });
    expect(await pg.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id))).toHaveLength(0);
    expect(await pg.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'invoice'), eq(schema.journals.sourceId, id)))).toHaveLength(0);
  });

  it('the lines are entered in the editor („Содржина“) and the invoice is booked; „Промена“ keeps lines and journal', async () => {
    const i0 = await inv(id);
    const payload = { id, kind: 'invoice', number: i0.number, date: i0.date, pdate: '', due: i0.due, partnerId: cust, warehouseId: '', art32: false, advance: false, export: false, svc: false,
      currency: 'MKD', fx: '1', refInvoiceId: '', creditKind: 'price', creditGross: '', fromDocId: '', note: i0.note ?? '', data: i0.data as Record<string, string>, advances: [],
      lines: [{ itemId: '', code: '', name: 'Сметководствена услуга', unit: 'час', qty: '2', price: '1000', disc: '0', rate: '18', account: '' }] };
    const s = await act(saveInvoiceAction({}, form({ payload: JSON.stringify(payload) })));
    expect(s).toMatchObject({ redirect: expect.stringMatching(/saved=/) });
    const booked = await inv(id);
    expect(booked.status).toBe('posted');
    expect(Number(booked.total)).toBe(2360);
    const [j] = await pg.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'invoice'), eq(schema.journals.sourceId, id)));
    expect(j).toBeTruthy();

    // „Промена (Ent)“: other due / note / Дополнително, the lines and the journal stay
    const r = await H.saveInvoiceHeadAction({}, head({ id, number: booked.number, days: '30', note1: 'нова напомена', refDoc: 'НАР-6', costType: 'Транспорт', saldo: 'Н' }));
    expect(r.ok).toMatch(/зачувани/);
    const i = await inv(id);
    expect(i).toMatchObject({ status: 'posted', number: booked.number, due: '2026-12-21', note: 'нова напомена' });
    expect(Number(i.total)).toBe(2360);
    expect(i.data).toMatchObject({ refDoc: 'НАР-6', costType: 'Транспорт', saldo: 'Н', days: '30' });
    // emptied fields of the dialog are removed (ОЕ, Група 1…)
    expect((i.data as Record<string, unknown>).oe).toBeUndefined();
    expect(await pg.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id))).toHaveLength(1);
    const J2 = await pg.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'invoice'), eq(schema.journals.sourceId, id)));
    expect(J2.map((x) => x.number)).toEqual([j!.number]);
  });

  it('„Авансна“ and „Фактура по член 32А без ДДВ“ come from the dialog', async () => {
    const r = await H.saveInvoiceHeadAction({}, head({ tip: 'advance', art32: '1' }));
    expect(await inv(r.id!)).toMatchObject({ advance: true, art32: true, status: 'draft' });
  });

  it('a production invoice is not changed from the dialog', async () => {
    const r = await H.saveInvoiceHeadAction({}, head({}));
    await pg.update(schema.invoices).set({ data: { prodRun: { lines: [{ lineNo: 1 }], orders: [] } } as never }).where(eq(schema.invoices.id, r.id!));
    expect((await H.saveInvoiceHeadAction({}, head({ id: r.id!, note1: 'x' }))).error).toMatch(/производство/);
  });
});
