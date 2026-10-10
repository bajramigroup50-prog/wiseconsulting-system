'use server';
/** Server actions for purchases (legacy `savePur` 7166 → `purPersist`, `delPur`, approval of client entries). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { approvePurchase, audit, createMissingItems, deletePurchase, ensurePartner, firms, markDraftSaved, partners, savePurchase, type PurchaseInput } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { actorOf } from '@/lib/sales';
import { scanEditorHref, scanQueue } from '@/lib/scan-queue';

const str = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(',', '.'));
const date = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Неважечки датум.');
const id = z.string().max(40);
const Cost = z.object({
  amount: str, fx: str, doc: z.string().max(100), date, due: date, partnerId: id, byQty: z.boolean(), foreign: z.boolean(),
  lines: z.array(z.object({ base: str, rate: str, vat: str })).max(3),
});
const Payload = z.object({
  id: z.string().nullable(), number: z.string().max(60), date: date.refine((s) => !!s, 'Внесете датум.'), docDate: date, due: date,
  partnerId: id, supplierName: z.string().max(300), supplierEdb: z.string().max(20), ptype: z.enum(['stock', 'cost']),
  art32: z.boolean(), imp: z.boolean(), cash: z.boolean(), noDed: z.boolean(), warehouseId: id, supplierAccount: z.string().max(10),
  currency: z.string().max(3), fx: str, calcNo: z.string().max(30), distMode: z.enum(['val', 'cn', 'multi']), cnames: z.array(str).max(15),
  groups: z.array(z.object({ account: z.string().max(10), rate: str, base: str, vat: str })).max(50),
  stock: z.array(z.object({
    itemId: id, name: z.string().max(500), code: z.string().max(60), barcode: z.string().max(40), unit: z.string().max(20), qty: str, price: str,
    rab: str, amount: str, cn: str, dep: str, sp: str, type: z.string().max(10), rate: str,
  }).passthrough()).max(3000),
  costs: z.record(z.string(), Cost), data: z.record(z.string(), z.string().max(500)), fileIds: z.array(z.uuid()).max(10),
  allowDuplicate: z.boolean().optional(),
  scanDocId: z.string().max(40).optional(), scanIndex: z.number().int().min(0).optional(), back: z.string().max(200).optional(),
  noNext: z.boolean().optional(),
}).passthrough();

export async function savePurchaseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let target = '';
  try {
    const p = Payload.safeParse(JSON.parse(String(form.get('payload') ?? '{}')));
    if (!p.success) return { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = p.data;
    const { u, firm } = await firmAction(v.id ? 'editPur' : 'savePur');
    const input: PurchaseInput = {
      ...v, partnerId: v.partnerId || null, warehouseId: v.warehouseId || null, scanned: !!v.scanDocId,
      stock: v.stock.map((s) => ({ ...s, itemId: s.itemId || null })),
      costs: Object.fromEntries(Object.entries(v.costs).map(([k, c]) => [k, { ...c, partnerId: c.partnerId || null, date: c.date || null, due: c.due || null }])),
    };
    const res = await db().transaction(async (tx) => {
      const r = await savePurchase(tx, firm.id, input, actorOf(u));
      if (v.scanDocId != null && v.scanIndex != null) await markDraftSaved(tx, firm.id, v.scanDocId, v.scanIndex, r.id);
      return r;
    });
    const back = v.back && /^\/[a-zA-Z]/.test(v.back) ? v.back : '/vlez';
    const q = new URLSearchParams({ saved: res.id });
    if (res.warnings.length) q.set('w', res.warnings.join(' | ').slice(0, 1500));
    target = back + (back.includes('?') ? '&' : '?') + q.toString();
    // legacy `nextScan` / batch: after saving a scanned invoice the next one of the run opens automatically
    if (v.scanDocId != null && v.scanIndex != null && !v.noNext) {
      const Q = await scanQueue(firm.id, v.scanDocId, v.scanIndex);
      if (Q?.next) target = (await scanEditorHref(firm.id, Q.next, back)) + '&prevSaved=' + res.id + (res.warnings.length ? '&w=' + encodeURIComponent(res.warnings.join(' | ').slice(0, 1500)) : '');
    }
  } catch (e) { return actionError(e); }
  revalidatePath('/', 'layout');
  redirect(target);
}

export async function deletePurchaseAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    await db().transaction((tx) => deletePurchase(tx, firm.id, id, actorOf(u)));
  } catch (e) { return actionError(e); }
  revalidatePath('/', 'layout');
  return { ok: 'Влезната фактура е избришана.' };
}

export async function approvePurchaseAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    await db().transaction((tx) => approvePurchase(tx, firm.id, id, actorOf(u)));
  } catch (e) { return actionError(e); }
  revalidatePath('/', 'layout');
  return { ok: 'Одобрено.' };
}

/** Legacy `addSupplier` (7161): add the read supplier to the partners now. */
export async function addSupplierAction(name: string, edb: string, foreign: boolean): Promise<ActionState & { id?: string; code?: string | null; name?: string; edb?: string | null }> {
  try {
    const nm = z.string().trim().min(1, 'Внесете назив.').max(300).parse(name);
    const ed = z.string().max(20).parse(edb ?? '');
    const { u, firm } = await firmAction('write');
    const r = await db().transaction(async (tx) => {
      const x = await ensurePartner(tx, firm.id, { name: nm, edb: ed, foreign, type: 'supplier' });
      const [p] = await tx.select({ code: partners.code }).from(partners).where(eq(partners.id, x.id)).limit(1);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'addSupplier', entityType: 'partner', entityId: x.id, data: { name: nm, edb: ed, created: x.created } });
      return { ...x, code: p?.code ?? null };
    });
    return { ok: 'Добавувачот е додаден.', id: r.id, code: r.code, name: nm, edb: ed || null };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? 'Неважечки податоци.' };
    return actionError(e);
  }
}

const NewItem = z.object({ name: z.string().max(500), code: z.string().max(60), barcode: z.string().max(40), unit: z.string().max(20), qty: str, price: str, rate: str, type: z.string().max(10) });

/** Legacy `createMissingItems` button (7164): the read articles not in the catalogue are added now. */
export async function createItemsAction(lines: z.input<typeof NewItem>[], partnerId: string): Promise<ActionState & { ids?: (string | null)[] }> {
  try {
    const L = z.array(NewItem).max(3000).parse(lines);
    const { u, firm } = await firmAction('write');
    const S = (firm.settings ?? {}) as Record<string, unknown>;
    const res = await db().transaction(async (tx) => {
      const pid = partnerId && /^[0-9a-f-]{36}$/i.test(partnerId) ? partnerId : null;
      const rows = L.map((l) => ({ ...l, itemId: null as string | null }));
      const n = await createMissingItems(tx, firm.id, rows, Number(S.defMargin) || 25, pid);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'createMissingItems', entityType: 'item', data: { count: n } });
      return { n, ids: rows.map((r) => r.itemId) };
    });
    revalidatePath('/artikli');
    return { ok: res.n ? `Додадени се ${res.n} нови артикли во шифрарникот (продажна цена = набавна + ${Number(S.defMargin) || 25}%, проверете ја).` : 'Артиклите се поврзани.', ids: res.ids };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: 'Неважечки податоци.' };
    return actionError(e);
  }
}

/** Legacy `applyMargin` (7162) remembers the margin and rounding as the firm defaults (`defMargin`, `mgRound`). */
export async function saveMarginDefaults(v: number, rd: string): Promise<void> {
  try {
    const { u, firm } = await firmAction('write');
    const S = { ...((firm.settings ?? {}) as Record<string, unknown>) };
    if (!Number.isFinite(v) || !['1', '0.5', '10', '0.01'].includes(rd)) return;
    if (Number(S.defMargin) === v && String(S.mgRound ?? '1') === rd) return;
    S.defMargin = v; S.mgRound = rd;
    await db().transaction(async (tx) => {
      await tx.update(firms).set({ settings: S }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'defMargin', entityType: 'firm', entityId: firm.id, data: { defMargin: v, mgRound: rd } });
    });
  } catch { /* the margins were applied in the editor; remembering them is best-effort */ }
}
