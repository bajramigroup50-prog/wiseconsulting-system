'use server';
/**
 * Server actions of the stock & retail screens. Every action is guarded with `requireCan(<legacy action>, firm)`
 * (via `stockAction` → `firmAction`), runs in one transaction with the document save, its stock moves, its journal(s)
 * and the audit row (see `@wise/db` stock-docs).
 */
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  deleteLevelling, deleteProductionOrder, deleteSalesDay, deleteStockCount, deleteTransfer, posSaleWithLoyalty, runProductionOrder, runStockReaverage,
  saveBom, saveLevelling, saveSalesDay, saveStockCount, saveTransfer,
} from '@wise/db';
import type { ActionState } from '@/lib/books';
import { stockAction, todayIso } from '@/lib/stock';
import { saveFiskOpt } from '@/lib/parity-fin';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Неважечки датум.');
const id = z.string().uuid().nullish();
const loc = z.string().max(40).nullish();
const num = z.union([z.number(), z.string()]).transform((v) => Number(String(v).replace(/\s/g, '').replace(',', '.'))).refine(Number.isFinite, 'Неважечки број.');
const numOpt = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v == null || v === '' ? null : Number(String(v).replace(/\s/g, '').replace(',', '.'))))
  .refine((v) => v == null || Number.isFinite(v), 'Неважечки број.');
const text = z.string().max(500).nullish();

function payload<T extends z.ZodType>(schema: T, form: FormData): z.infer<T> | { error: string } {
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('payload') ?? '{}')); } catch { return { error: 'Неважечки податоци.' }; }
  const p = schema.safeParse(raw);
  return p.success ? p.data : { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
}
const isErr = (x: unknown): x is { error: string } => !!x && typeof x === 'object' && 'error' in x;
const done = (st: ActionState, to: string): ActionState => {
  if (st.error) return st;
  redirect(to);
};

/* ---------------- transfers ---------------- */

const TransferIn = z.object({
  id, date, from: loc, to: loc, note: text,
  lines: z.array(z.object({ itemId: z.string().uuid(), qty: num, sp: numOpt })).max(2000),
});

export async function saveTransferAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const v = payload(TransferIn, form);
  if (isErr(v)) return v;
  return done(await stockAction('prSave', ['/prenosi'], (tx, a) => saveTransfer(tx, a, v)), '/prenosi');
}
export async function deleteTransferAction(docId: string): Promise<ActionState> {
  return stockAction('prDel', ['/prenosi'], (tx, a) => deleteTransfer(tx, a, docId));
}

/* ---------------- levelling ---------------- */

const LevellingIn = z.object({
  id, date, wh: loc, note: text, promoTo: date.nullish().or(z.literal('')),
  prices: z.record(z.string().uuid(), numOpt),
});

export async function saveLevellingAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const v = payload(LevellingIn, form);
  if (isErr(v)) return v;
  return done(await stockAction('saveNivel', ['/nivel'], (tx, a) => saveLevelling(tx, a, { ...v, promoTo: v.promoTo || null, today: todayIso() })), '/nivel');
}
export async function deleteLevellingAction(docId: string): Promise<ActionState> {
  return stockAction('nivDel', ['/nivel'], (tx, a) => deleteLevelling(tx, a, docId, todayIso()));
}

/* ---------------- stock counts / write-offs ---------------- */

const account = z.string().regex(/^\d{3,10}$/, 'Контото мора да има само цифри.').nullish().or(z.literal(''));
const CountIn = z.object({
  id, kind: z.enum(['count', 'writeoff']), date, wh: loc, note: text, shortageAccount: account, surplusAccount: account,
  lines: z.array(z.object({ itemId: z.string().uuid(), cnt: numOpt, qty: numOpt })).max(5000),
});

export async function saveStockCountAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const v = payload(CountIn, form);
  if (isErr(v)) return v;
  return done(await stockAction('moSave', ['/m_izlez'], (tx, a) => saveStockCount(tx, a, { ...v, shortageAccount: v.shortageAccount || null, surplusAccount: v.surplusAccount || null })), '/m_izlez?t=' + v.kind);
}
export async function deleteStockCountAction(docId: string): Promise<ActionState> {
  return stockAction('moDel', ['/m_izlez'], (tx, a) => deleteStockCount(tx, a, docId));
}

/* ---------------- POS / fiscal reports ---------------- */

const CartIn = z.object({
  date, wh: loc, card: numOpt,
  cart: z.array(z.object({ itemId: z.string().uuid(), qty: num, price: num, rate: numOpt })).min(1, 'Додадете барем еден артикл.').max(500),
  cardNo: z.string().max(60).nullish(), coupon: z.string().max(60).nullish(), usePts: z.boolean().optional(), order: z.string().uuid().nullish(),
});

/**
 * Legacy `posSell` + loyalty wrapper 9940: the sale goes into the POS day; a loyalty card / coupon / points give the
 * discount lines and update the card. The till stays open for the next receipt (legacy toast).
 */
export async function posSellAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const v = payload(CartIn, form);
  if (isErr(v)) return v;
  const st = await stockAction('posSell', ['/kasa', '/lojalnost', '/restoran', '/kujna'], (tx, a) => posSaleWithLoyalty(tx, a, { ...v, orderId: v.order ?? null }));
  if (st.error) return st;
  const r = st.data!;
  if (v.order) redirect('/restoran');
  return {
    ok: 'Продажбата е евидентирана и залихата е раздолжена.' + (r.disc ? ` Попуст ${r.disc.toFixed(2)} · за плаќање ${r.pay.toFixed(2)}.` : '')
      + (r.card ? ` 💳 ${r.card.name}: +${r.card.earn} поени${r.card.red ? ', искористени ' + r.card.red : ''} · вкупно ${r.card.points}` : ''),
  };
}

const FiskIn = z.object({
  id, date, wh: loc, number: text, note: text,
  gross: z.record(z.string().regex(/^(0|5|10|18)$/), num),
  total: numOpt, card: numOpt, cardAccount: z.string().regex(/^\d{3,10}$/).nullish().or(z.literal('')),
  sc: z.enum(['', 'trg', 'usl', 'trgNoVat']).optional().default(''), from: date.nullish().or(z.literal('')), to: date.nullish().or(z.literal('')),
  meth: z.enum(['fifo', 'lifo', 'prop']).optional(), issue: z.boolean().optional(),
  lines: z.array(z.object({ itemId: z.string().uuid(), qty: num, price: num, rate: numOpt })).max(2000).optional().default([]),
  // finance parity (legacy fk_k / fk_ck / fk_cash / fk_nv, 11422–11428, 13104): revenue, card and cash kontos, no-VAT
  rev: z.string().regex(/^\d{3,10}$/).nullish().or(z.literal('')), cashK: z.string().regex(/^\d{3,10}$/).nullish().or(z.literal('')),
  nonVat: z.boolean().optional(), replace: z.boolean().optional(), device: z.string().max(60).nullish(),
});

export async function saveFiskAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const v = payload(FiskIn, form);
  if (isErr(v)) return v;
  const st = await stockAction('fkPost', ['/fiskPer', '/kdfi'], async (tx, a) => {
    const r = await saveSalesDay(tx, a, {
      id: v.id, kind: 'fisk', date: v.date, wh: v.wh, number: v.number, gross: v.gross, total: v.total, card: v.card, cardAccount: v.cardAccount || null,
      note: v.note, issue: !!v.issue, lines: v.lines, replace: !!v.replace,
      fisk: {
        ...(v.sc ? { sc: v.sc } : {}), ...(v.from ? { from: v.from } : {}), ...(v.to ? { to: v.to } : {}), ...(v.meth ? { meth: v.meth } : {}),
        ...(v.rev ? { rev: v.rev } : {}), ...(v.cashK ? { cashK: v.cashK } : {}), ...(v.nonVat ? { nonVat: true } : {}), ...(v.device ? { device: v.device } : {}),
      },
    });
    // legacy `saveFirmPatch({fiskOpt})` 11453: remember the location, kontos, scheme and method
    await saveFiskOpt(tx, a.firmId, { wh: v.wh ?? undefined, cardK: v.cardAccount || undefined, sc: v.sc || undefined, cashK: v.cashK || undefined, meth: v.meth, konto: v.rev || undefined });
    return r;
  });
  return done(st, '/fiskPer');
}
export async function deleteSalesDayAction(docId: string): Promise<ActionState> {
  return stockAction('fkDel', ['/fiskPer', '/kasa', '/kdfi'], (tx, a) => deleteSalesDay(tx, a, docId));
}

/* ---------------- production ---------------- */

const BomIn = z.object({ productId: z.string().uuid(), labor: num, lines: z.array(z.object({ itemId: z.string().uuid(), qty: num })).max(500) });

export async function saveBomAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const v = payload(BomIn, form);
  if (isErr(v)) return v;
  const st = await stockAction('saveBom', ['/normativ', '/prod'], (tx, a) => saveBom(tx, a, v));
  return st.error ? st : { ok: 'Нормативот е зачуван.' };
}

const ProdIn = z.object({ date, productId: z.string().uuid(), qty: num, wh: loc, note: text });

export async function runProdAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const v = payload(ProdIn, form);
  if (isErr(v)) return v;
  const st = await stockAction('runProd', ['/prod'], (tx, a) => runProductionOrder(tx, a, v));
  // legacy toast „Произведени … ; цена на чинење … ден.“ — shown by the page from `?done=`
  return done(st, st.data ? `/prod?done=${st.data.id}` : '/prod');
}
export async function deleteProdAction(docId: string): Promise<ActionState> {
  const st = await stockAction('delProd', ['/prod'], (tx, a) => deleteProductionOrder(tx, a, docId));
  return st.error ? st : { ok: 'Налогот е сторниран и залихата е вратена.' };
}

/* ---------------- re-averaging ---------------- */

export async function reaverageAction(): Promise<ActionState> {
  const st = await stockAction('runUprosek', ['/uprosek'], (tx, a) => runStockReaverage(tx, a));
  if (st.error) return st;
  const d = st.data!;
  return { ok: `Преработени ${d.changed} движења во ${d.sources} документи${d.skippedLocked ? `; ${d.skippedLocked} во заклучен период не се менувани` : ''}.` };
}
