'use server';
/**
 * Server actions added in the stock / production / codebook parity pass. Guarded with `requireCan(<legacy action>)`
 * (via `stockAction` / `firmAction`), one transaction with the audit row (`@wise/db` parity-stock).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isCbKey, cbIsGlobal } from '@wise/core/codebooks';
import { and, eq, inArray } from 'drizzle-orm';
import { StockDocError, audit, deleteItemsStock, importAccounts, importCodebook, items, partners, patchFirmSettings, runCustomProductionOrder, supplierOrders, type Tx } from '@wise/db';
import { dispatchMail, queueMail } from '@/lib/mail';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { requireCan, requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { numIn, stockAction } from '@/lib/stock';

function json<T extends z.ZodType>(schema: T, form: FormData): z.infer<T> | { error: string } {
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('payload') ?? '{}')); } catch { return { error: 'Неважечки податоци.' }; }
  const p = schema.safeParse(raw);
  return p.success ? p.data : { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
}
const isErr = (x: unknown): x is { error: string } => !!x && typeof x === 'object' && 'error' in x && Object.keys(x).length === 1;
const num = z.union([z.number(), z.string()]).transform((v) => numIn(v)).refine(Number.isFinite, 'Неважечки број.');
const KEPT: Record<string, string> = { purchase: 'влезни фактури', invoice: 'излезни фактури', dispatch: 'испратници', supplier_credit: 'повратници', sales_daily: 'каса / фискални', production: 'производство', writeoff_doc: 'раздолжувања', levelling: 'нивелации' };

/* ---------------- Лагер листа: бришење на залиха (legacy lgDel, само администратор) ---------------- */

export async function deleteItemsStockAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ids = f.getAll('lgs').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const wh = String(f.get('wh') ?? '') || null;
  try {
    const { u } = await firmAction('del');
    if (u.role !== 'admin') return { error: 'Бришење може само администраторот.' };
  } catch (e) { return actionError(e); }
  const st = await stockAction('del', ['/g_lager', '/g_lagerk', '/m_lager', '/m_lagerp', '/zaliha'], (tx, a) => deleteItemsStock(tx, a, { itemIds: ids, wh }));
  if (st.error) return st;
  const r = st.data!;
  const kept = Object.entries(r.kept).map(([k, n]) => `${n} (${KEPT[k] ?? k})`).join(', ');
  return { ok: `Избришани ${r.deleted} движења за ${ids.length} артикли${r.docsRemoved ? `, ${r.docsRemoved} празни документи` : ''}.${r.locked ? ` ${r.locked} во заклучен период се прескокнати.` : ''}${kept ? ` Задржани движења од документи: ${kept} – избришете ги од самиот документ.` : ''}` };
}

/* ---------------- Работен налог: свои материјали / без норматив (legacy pcRun, pnbRun) ---------------- */

const CustomIn = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Неважечки датум.'), productId: z.string().uuid(), qty: num, wh: z.string().max(40).nullish(),
  mode: z.enum(['custom', 'pct']), pct: num.optional(), saveAsBom: z.boolean().optional(),
  lines: z.array(z.object({ itemId: z.string().uuid(), qty: num })).max(500).optional(),
});

export async function customProdAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = json(CustomIn, f);
  if (isErr(v)) return v;
  const st = await stockAction(v.mode === 'pct' ? 'pnbRun' : 'pcRun', ['/prod', '/normativ'], (tx, a) => runCustomProductionOrder(tx, a, v));
  if (st.error) return st;
  redirect(`/prod?done=${st.data!.id}&m=${v.mode === 'pct' ? 'pct' : v.saveAsBom ? 'bom' : ''}`);
}

/** Legacy `pnb_pct` change → `saveFirmPatch({rnPct})`. */
export async function rnPctAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = numIn(String(f.get('pct') ?? ''));
  if (!(v > 0 && v <= 100)) return { error: 'Внесете процент од 1 до 100.' };
  const st = await stockAction('settings', ['/prod'], (tx, a) => patchFirmSettings(tx, a, { rnPct: v }, 'rnPct'));
  return st.error ? st : { ok: 'Зачувано.' };
}

/* ---------------- Шифрарници: увоз од Excel ---------------- */

const RowsIn = z.object({ rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).max(20000) });

export async function importCodebookAction(k: string, _p: ActionState, f: FormData): Promise<ActionState> {
  if (!isCbKey(k)) return { error: 'Непознат шифрарник.' };
  const v = json(RowsIn, f);
  if (isErr(v)) return v;
  try {
    const u0 = await requireUser();
    const firm = cbIsGlobal(k) ? null : await currentFirm(u0);
    if (!cbIsGlobal(k) && !firm) return { error: 'Изберете фирма.' };
    const u = await requireCan(cbIsGlobal(k) ? 'settings' : 'write', firm?.id ?? null);
    const R = await db().transaction((tx) => importCodebook(tx as unknown as Tx, { userId: u.id, firmId: firm?.id ?? null, k, rows: v.rows }));
    revalidatePath(`/cb_${k}`);
    return { ok: `Увезено: ${R.add} нови, ${R.upd} ажурирани${R.skip.length ? `; прескокнати ${R.skip.length}: ${R.skip.slice(0, 8).join(' · ')}` : '.'}` };
  } catch (e) { return actionError(e); }
}

export async function importAccountsAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = json(RowsIn, f);
  if (isErr(v)) return v;
  try {
    const { u, firm } = await firmAction('saveAcc');
    const R = await db().transaction((tx) => importAccounts(tx as unknown as Tx, { userId: u.id, firmId: firm.id, rows: v.rows }));
    revalidatePath('/konto');
    return { ok: `Увезено: ${R.add} нови конта, ${R.upd} изменети називи${R.skip.length ? `; прескокнати ${R.skip.length}: ${R.skip.slice(0, 8).join(' · ')}` : '.'}` };
  } catch (e) { return actionError(e); }
}

/* ---------------- Нарачка до добавувач по е-пошта (legacy poMail) ---------------- */

const escH = (x: unknown) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function poMailAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('poMail');
    const ids = await db().transaction(async (t) => {
      const tx = t as unknown as Tx;
      const [o] = await tx.select().from(supplierOrders).where(and(eq(supplierOrders.id, id), eq(supplierOrders.firmId, firm.id))).limit(1);
      if (!o) throw new StockDocError('Нарачката не постои.');
      const [p] = o.partnerId ? await tx.select().from(partners).where(eq(partners.id, o.partnerId)).limit(1) : [];
      if (!p?.email) throw new StockDocError('Добавувачот нема е-пошта.');
      const its = o.lines.length ? await tx.select({ id: items.id, code: items.code }).from(items).where(inArray(items.id, o.lines.map((l) => l.itemId))) : [];
      const code = new Map(its.map((i) => [i.id, i.code ?? '']));
      const html = `<p>Почитувани,</p><p>Во прилог Ви ја испраќаме нарачката бр. ${escH(o.number)} од ${escH(o.date.split('-').reverse().join('.'))}. Ве молиме потврдете цена и рок на испорака.</p>`
        + '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse"><thead><tr><th>Р.бр</th><th>Шифра</th><th>Артикл</th><th>ЕМ</th><th>Количина</th></tr></thead><tbody>'
        + o.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${escH(code.get(l.itemId))}</td><td>${escH(l.name)}</td><td>${escH(l.unit)}</td><td style="text-align:right">${escH(String(l.qty).replace('.', ','))}</td></tr>`).join('')
        + `</tbody></table>${o.note ? `<p>${escH(o.note)}</p>` : ''}<p>Со почит,<br>${escH(firm.name)}${firm.phone ? '<br>Тел.: ' + escH(firm.phone) : ''}</p>`;
      const mid = await queueMail(tx, { firmId: firm.id, to: p.email, subject: `Нарачка ${o.number} – ${firm.name}`, html, entityType: 'supplier_order', entityId: o.id, userId: u.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'poMail', entityType: 'supplier_order', entityId: o.id, data: { to: p.email } });
      return [mid];
    });
    await dispatchMail(ids);
    return { ok: 'Испратено на добавувачот.' };
  } catch (e) {
    if (e instanceof StockDocError) return { error: e.message };
    return actionError(e);
  }
}
