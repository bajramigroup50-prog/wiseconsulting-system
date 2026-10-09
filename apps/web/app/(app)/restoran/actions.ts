'use server';
/** Legacy restaurant ACT (9976, 9991): tables, bill lines, kitchen, pay through the Phase 7 POS (FIX 10.4 item 10). */
import { and, eq } from 'drizzle-orm';
import { retailPrice } from '@wise/core';
import { orderAdd, orderQty, orderSend } from '@wise/core/industry';
import { deleteDoc, items, markLineReady, openOrderOf, payOrder, saveOrder, saveTable, toStockItem, voidOrder } from '@wise/db';
import { indRun, nowLocal, num, str, today } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/restoran', '/kujna', '/kasa', '/m_izlez'];

export async function saveTableAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('rtSave', P, async ({ tx, a }) => {
    await saveTable(tx, a, str(f.get('id')) || null, { no: str(f.get('no')), area: str(f.get('area')), seats: num(f.get('seats')) ?? 4 });
    return 'Масата е зачувана.';
  });
}
export async function deleteTableAction(id: string): Promise<FormState> {
  return indRun('rtSave', P, async ({ tx, a }) => {
    if (await openOrderOf(tx, a.firmId, id)) return 'Масата има отворена сметка.';
    await deleteDoc(tx, a, 'rtable', id);
    return 'Отстрането.';
  });
}

export async function addItemAction(table: string, itemId: string, wh: string): Promise<FormState> {
  return indRun('roAdd', P, async ({ tx, a, u }) => {
    const [it] = await tx.select().from(items).where(and(eq(items.id, itemId), eq(items.firmId, a.firmId))).limit(1);
    if (!it) return 'Артиклот не постои.';
    const o = await openOrderOf(tx, a.firmId, table);
    await saveOrder(tx, a, table, orderAdd(o?.data.lines ?? [], { id: it.id, name: it.name, price: retailPrice(toStockItem(it), wh), rate: it.vatRate }), o?.data.waiter || u.name, nowLocal());
  });
}

export async function lineAction(table: string, i: number, op: 'inc' | 'dec' | 'note', note?: string): Promise<FormState> {
  return indRun('roQ', P, async ({ tx, a }) => {
    const o = await openOrderOf(tx, a.firmId, table);
    if (!o) return;
    const L = op === 'note' ? o.data.lines.map((l, k) => (k === i ? { ...l, note: note ?? '' } : l)) : orderQty(o.data.lines, i, op === 'inc' ? 1 : -1);
    await saveOrder(tx, a, table, L, o.data.waiter, nowLocal());
  });
}

export async function noteAction(_p: FormState, f: FormData): Promise<FormState> {
  return lineAction(str(f.get('table')), Number(f.get('i')), 'note', str(f.get('note')));
}

export async function sendKitchenAction(table: string): Promise<FormState> {
  return indRun('roSend', P, async ({ tx, a }) => {
    const o = await openOrderOf(tx, a.firmId, table);
    if (!o) return;
    await saveOrder(tx, a, table, orderSend(o.data.lines, nowLocal()), o.data.waiter, nowLocal());
    return 'Испратено во кујна.';
  });
}

export async function payAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('posSell', P, async ({ tx, a }) => {
    const wh = str(f.get('wh'));
    const r = await payOrder(tx, a, str(f.get('order')), { date: today(), wh: wh && wh !== 'main' ? wh : null, card: num(f.get('card')), now: nowLocal() });
    return `Наплатено ${r.total.toFixed(2)} ден. – продажбата е во дневниот промет на касата.`;
  });
}

export async function voidAction(orderId: string): Promise<FormState> {
  return indRun('roClose', P, async ({ tx, a }) => { await voidOrder(tx, a, orderId); return 'Сметката е затворена.'; });
}

export async function readyAction(orderId: string, i: number): Promise<FormState> {
  return indRun('kjReady', P, async ({ tx, a }) => { await markLineReady(tx, a, orderId, i, nowLocal()); });
}
