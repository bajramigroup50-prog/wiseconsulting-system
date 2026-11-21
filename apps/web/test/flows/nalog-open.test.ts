/**
 * Налози за книжење like the old program: „Нов (Ins)“ → „Податоци за налог“ opens an empty nalog (number F5 / automatic,
 * date, description, Прекн. – Непрекн.); its lines come with „Книжење“. A „Непрекнижан“ nalog keeps its lines on the
 * nalog, outside the ledger (cards, balances) until „Прекн. = Да“ posts them; back to „Не“ takes them out again (PGlite).
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { act, form, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const A = await import('@/app/(app)/nalozi/actions');
let firmId = '';
const jOf = async (no: string) => (await pg.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.number, no))))[0]!;
const ledger = async (id: string) => pg.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, id));
const rows = [{ account: '4400', partnerId: '', debit: '500', credit: '', note: 'трошок', doc: '' }, { account: '1000', partnerId: '', debit: '', credit: '500', note: '', doc: '' }];

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'Отворање Налог ДООЕЛ' }).returning();
  firmId = f!.id;
  await signIn('admin');
  useFirm(firmId); useYear(2026);
});

describe('„Нов (Ins)“ → „Податоци за налог“', () => {
  it('F5 suggests the next number; „Во ред“ opens an empty nalog; a used number is refused', async () => {
    const s = await A.nextNalogNumberAction('2026-11-21');
    expect(s.no).toBeTruthy();
    const r = await A.openNalogAction({}, form({ number: '', date: '2026-11-21', description: 'ИЗВОДИ НОЕМВРИ', prek: 'da' }));
    expect(r.ok).toMatch(/отворен/);
    expect(r.no).toBe(s.no);
    const j = await jOf(r.no!);
    expect(j).toMatchObject({ kind: 'manual', description: 'ИЗВОДИ НОЕМВРИ', date: '2026-11-21' });
    expect(await ledger(j.id)).toHaveLength(0);
    expect((await A.openNalogAction({}, form({ number: r.no!, date: '2026-11-22', prek: 'da' }))).error).toMatch(/веќе постои/);
  });

  it('a „Непрекнижан“ nalog keeps its lines outside the ledger until „Прекн. = Да“', async () => {
    const r = await A.openNalogAction({}, form({ number: 'Т-1', date: '2026-11-21', description: 'нацрт', prek: 'ne' }));
    const j = await jOf('Т-1');
    expect((j.meta as { prek?: boolean }).prek).toBe(false);
    // „Книжење“: the lines are saved on the nalog only
    const sv = await act(A.saveJournal({}, form({ payload: JSON.stringify({ id: j.id, number: 'Т-1', date: '2026-11-21', description: 'нацрт', periodFrom: '', periodTo: '', rows }), stay: '1' })));
    expect(sv).toMatchObject({ ok: 'Т-1' });
    expect(await ledger(j.id)).toHaveLength(0);
    expect(((await jOf('Т-1')).meta as { rows: unknown[] }).rows).toHaveLength(2);
    // „Промена“ → Прекн. = Да: posted (balanced) into the ledger
    expect((await A.openNalogAction({}, form({ id: j.id, number: 'Т-1', date: '2026-11-21', description: 'нацрт', prek: 'da' }))).ok).toBeTruthy();
    const L = await ledger(j.id);
    expect(L.map((l) => [l.account, Number(l.debit), Number(l.credit)])).toEqual([['4400', 500, 0], ['1000', 0, 500]]);
    // back to „Не“: out of the ledger again, the lines kept on the nalog
    expect((await A.openNalogAction({}, form({ id: j.id, number: 'Т-1', date: '2026-11-21', description: 'нацрт', prek: 'ne' }))).ok).toBeTruthy();
    expect(await ledger(j.id)).toHaveLength(0);
    expect(((await jOf('Т-1')).meta as { rows: { debit: string }[] }).rows.map((x) => x.debit)).toEqual(['500', '']);
    expect(r.no).toBe('Т-1');
  });

  it('an unbalanced „Непрекнижан“ nalog cannot be switched to „Да“', async () => {
    await A.openNalogAction({}, form({ number: 'Т-2', date: '2026-11-21', prek: 'ne' }));
    const j = await jOf('Т-2');
    await act(A.saveJournal({}, form({ payload: JSON.stringify({ id: j.id, number: 'Т-2', date: '2026-11-21', description: '', periodFrom: '', periodTo: '', rows: [rows[0]] }), stay: '1' })));
    expect((await A.openNalogAction({}, form({ id: j.id, number: 'Т-2', date: '2026-11-21', prek: 'da' }))).error).toMatch(/изедначен/);
    expect(await ledger(j.id)).toHaveLength(0);
  });

  it('„Нова ставка“: документ датум, валута, аванс, ОЕ, Г1 / Г2, тип на трошок, забелешка are kept on the line (not in the sums)', async () => {
    await A.openNalogAction({}, form({ number: 'Т-3', date: '2026-11-21', prek: 'da' }));
    const j = await jOf('Т-3');
    const meta = { docDate: '2026-11-15', due: '2026-12-15', advance: true, oe: '01', store: 'П1', g1: 'А', g2: 'Б', costType: 'Канцелариски', remark: 'по договор', bogus: 'x' };
    await act(A.saveJournal({}, form({ payload: JSON.stringify({ id: j.id, number: 'Т-3', date: '2026-11-21', description: '', periodFrom: '', periodTo: '', rows: [{ ...rows[0], meta }, rows[1]] }), stay: '1' })));
    const L = await ledger(j.id);
    expect(L[0]!.meta).toEqual({ docDate: '2026-11-15', due: '2026-12-15', advance: true, oe: '01', store: 'П1', g1: 'А', g2: 'Б', costType: 'Канцелариски', remark: 'по договор' });
    expect(L[1]!.meta).toBeNull();
    expect(L.map((l) => Number(l.debit) - Number(l.credit))).toEqual([500, -500]);
  });
});
