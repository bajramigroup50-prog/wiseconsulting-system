'use server';
/**
 * Server actions for outgoing documents (Излез, Услуги, Одобренија, Профактури, Испратници): legacy `saveInv`,
 * `delDoc`, approval of client entries, invoice styling settings. Every action is guarded and audited (the services
 * write the audit rows inside the document transaction).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { isFuel } from '@wise/core/sales';
import { z } from 'zod';
import { aiDocuments, approveInvoice, audit, deleteInvoice, fileLinks, firms, items, markDraftSaved, saveInvoice } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { actorOf } from '@/lib/sales';
import { scanEditorHref, scanQueue } from '@/lib/scan-queue';

const str = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(',', '.'));
const date = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Неважечки датум.');
const Line = z.object({
  itemId: z.string().max(40), code: z.string().max(60), name: z.string().max(500), unit: z.string().max(20),
  qty: str, price: str, disc: str, rate: str, account: z.string().max(10),
});
const Payload = z.object({
  id: z.string().nullable(), kind: z.enum(['invoice', 'credit', 'proforma', 'dispatch']), number: z.string().max(40),
  date: date.refine((s) => !!s, 'Внесете датум.'), pdate: date, due: date, partnerId: z.string().max(40), warehouseId: z.string().max(40),
  art32: z.boolean(), advance: z.boolean(), export: z.boolean(), svc: z.boolean(), currency: z.string().max(3), fx: str,
  refInvoiceId: z.string().max(40), creditKind: z.enum(['price', 'gross', 'ret']), creditGross: str, fromDocId: z.string().max(40),
  note: z.string().max(4000), data: z.record(z.string(), z.string().max(500)),
  lines: z.array(Line).max(2000), advances: z.array(z.object({ advanceId: z.string().max(40), amount: str })).max(100),
  scanDocId: z.string().max(40).optional(), scanIndex: z.number().int().min(0).optional(), back: z.string().max(200).optional(),
});

/** List view of a document kind. */
const viewOf = (kind: string, svc: boolean) => ({ credit: 'odobrenija', proforma: 'profakturi', dispatch: 'ispratnici' })[kind] ?? (svc ? 'uslugi' : 'izlez');

export async function saveInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let target = '';
  try {
    const p = Payload.safeParse(JSON.parse(String(form.get('payload') ?? '{}')));
    if (!p.success) return { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = p.data;
    const { u, firm } = await firmAction(v.id ? 'editInv' : 'saveInv');
    const res = await db().transaction(async (tx) => {
      const r = await saveInvoice(tx, firm.id, {
        ...v, lines: v.lines.map((l) => ({ ...l, itemId: l.itemId || null })), partnerId: v.partnerId || null, warehouseId: v.warehouseId || null,
        refInvoiceId: v.refInvoiceId || null, fromDocId: v.fromDocId || null, scanned: !!v.scanDocId,
        advances: v.advances.filter((a) => Number(a.amount) > 0),
        data: v.data,
      }, actorOf(u));
      if (v.scanDocId != null && v.scanIndex != null) {
        await markDraftSaved(tx, firm.id, v.scanDocId, v.scanIndex, r.id);
        // the scanned original stays attached to the invoice (legacy `outDraft` files: [att])
        const [ad] = await tx.select({ f: aiDocuments.fileId }).from(aiDocuments).where(and(eq(aiDocuments.id, v.scanDocId), eq(aiDocuments.firmId, firm.id))).limit(1);
        if (ad?.f) await tx.insert(fileLinks).values({ fileId: ad.f, entityType: 'invoice', entityId: r.id, role: 'source' }).onConflictDoNothing();
      }
      return r;
    });
    // legacy saveInv wrapper 14307: remember the free-text service names (max 60) for the editor datalist
    const nm = v.lines.filter((l) => !l.itemId && l.name.trim().length > 2).map((l) => l.name.trim());
    if (nm.length) {
      const S0 = (firm.settings ?? {}) as Record<string, unknown>;
      const old = Array.isArray(S0.svcTexts) ? (S0.svcTexts as string[]) : [];
      const L = [...new Set([...nm, ...old])].slice(0, 60);
      if (L.join('|') !== old.join('|')) await db().update(firms).set({ settings: { ...S0, svcTexts: L } }).where(eq(firms.id, firm.id));
    }
    const back = v.back && /^\/[a-zA-Z]/.test(v.back) ? v.back : '/' + viewOf(v.kind, v.svc);
    const q = new URLSearchParams({ saved: res.id });
    if (res.warnings.length) q.set('w', res.warnings.join(' | ').slice(0, 1500));
    target = back + (back.includes('?') ? '&' : '?') + q.toString();
    // legacy `outSaveOne` / scan queue: the next scanned invoice of the run opens automatically
    if (v.scanDocId != null && v.scanIndex != null) {
      const Q = await scanQueue(firm.id, v.scanDocId, v.scanIndex);
      if (Q?.next) target = (await scanEditorHref(firm.id, Q.next, back)) + '&prevSaved=' + res.id;
    }
  } catch (e) { return actionError(e); }
  revalidatePath('/', 'layout');
  redirect(target);
}

/** Delete a document (needs `del`, like legacy `delOk`). */
export async function deleteInvoiceAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    await db().transaction((tx) => deleteInvoice(tx, firm.id, id, actorOf(u)));
  } catch (e) { return actionError(e); }
  revalidatePath('/', 'layout');
  return { ok: 'Документот е избришан.' };
}

/** Approve a client-submitted document and book it. */
export async function approveInvoiceAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    await db().transaction((tx) => approveInvoice(tx, firm.id, id, actorOf(u)));
  } catch (e) { return actionError(e); }
  revalidatePath('/', 'layout');
  return { ok: 'Документот е одобрен и прокнижен.' };
}

const STYLE_KEYS = ['invStyle', 'invColor', 'invNote', 'bank', 'bankName', 'signer', 'signerRole', 'short', 'legalFoot', 'logo', 'sign', 'stamp', 'cert_serial', 'cert_thumb'] as const;

/** Invoice print settings (legacy firm fields `invStyle`, `invColor`, `invNote`, `legalFoot`, …; needs `settings`). */
export async function saveInvoiceStyle(form: FormData): Promise<void> {
  const { u, firm } = await firmAction('settings');
  const s = { ...(firm.settings ?? {}) } as Record<string, unknown>;
  const ch: Record<string, unknown> = {};
  for (const k of STYLE_KEYS) {
    if (!form.has(k)) continue;
    const v = String(form.get(k) ?? '').slice(0, k === 'invNote' ? 4000 : 300);
    if (k === 'invNote' && form.get('invNoteDefault') === 'on') { delete s.invNote; ch.invNote = null; continue; }
    if (s[k] !== v) { s[k] = v; ch[k] = v; }
  }
  // uploaded logo / signature / stamp images (legacy file inputs in the firm form)
  for (const k of ['logo', 'sign', 'stamp'] as const) { const up = String(form.get(k + 'Up') ?? ''); if (/^[0-9a-f-]{36}$/i.test(up)) { s[k] = up; ch[k] = up; } }
  // legacy `qr` checkbox: QR on the invoice unless switched off
  if (form.has('qr')) { const q = form.get('qr') === '1'; if ((s.qr !== false) !== q) { s.qr = q; ch.qr = q; } }
  await db().transaction(async (tx) => {
    await tx.update(firms).set({ settings: s }).where(eq(firms.id, firm.id));
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'invStyle', entityType: 'firm', entityId: firm.id, data: ch });
  });
  revalidatePath('/izlez');
}

/** Legacy `#svcOnly` switch (14298): the firm offers only services – the quick-add bar is replaced by free text. */
export async function setSvcOnlyAction(v: boolean): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('settings');
    await db().transaction(async (tx) => {
      await tx.update(firms).set({ settings: { ...((firm.settings ?? {}) as Record<string, unknown>), svcOnly: !!v } }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'svcOnly', entityType: 'firm', entityId: firm.id, data: { svcOnly: !!v } });
    });
  } catch (e) { return actionError(e); }
  return { ok: v ? 'Фирмата е означена: само услуги.' : 'Брзото додавање артикли е вклучено.' };
}

/** Legacy `crModeHTML` (3445) + change handler (4200): credit notes with minus (red storno) or on the opposite side. */
export async function saveCrMode(form: FormData): Promise<void> {
  const v = form.get('crMode') === 'flip' ? 'flip' : 'minus';
  const { u, firm } = await firmAction('settings');
  await db().transaction(async (tx) => {
    await tx.update(firms).set({ settings: { ...((firm.settings ?? {}) as Record<string, unknown>), crMode: v } }).where(eq(firms.id, firm.id));
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'crMode', entityType: 'firm', entityId: firm.id, data: { crMode: v, text: 'Книжење одобренија: ' + (v === 'minus' ? 'минус (сторно)' : 'обратна страна') } });
  });
  revalidatePath('/odobrenija');
}

/** Legacy `bkDel` (16917): admin bulk delete with the usual per-document checks. */
export async function deleteInvoicesAction(ids: string[]): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    if (u.role !== 'admin') return { error: 'Бришење може само администраторот.' };
    const L = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 2000);
    let n = 0;
    for (const id of L) { try { await db().transaction((tx) => deleteInvoice(tx, firm.id, id, actorOf(u))); n++; } catch { /* locked / linked: skipped */ } }
    await db().transaction((tx) => audit(tx, { userId: u.id, firmId: firm.id, action: 'bulkDelete', entityType: 'invoice', data: { text: `Масовно бришење (излез): ${n} од ${L.length}` } }));
    revalidatePath('/', 'layout');
    return { ok: 'Избришани ' + n + ' од ' + L.length + (n < L.length ? ' – останатите не може (заклучен период или поврзани документи).' : '.') };
  } catch (e) { return actionError(e); }
}

/** Legacy `fuelItemsRate` (14367): the VAT rate in force on every fuel item. */
export async function fuelItemsRateAction(rate: number): Promise<ActionState> {
  try {
    if (![18, 10, 5, 0].includes(rate)) return { error: 'Неважечка стапка.' };
    const { u, firm } = await firmAction('settings');
    const I = (await db().select({ id: items.id, name: items.name, r: items.vatRate, type: items.type }).from(items).where(eq(items.firmId, firm.id)))
      .filter((i) => i.type !== 'service' && isFuel(i.name) && i.r !== rate);
    if (!I.length) return { ok: 'Сите артикли гориво веќе се со ' + rate + '%.' };
    await db().transaction(async (tx) => {
      await tx.update(items).set({ vatRate: rate }).where(inArray(items.id, I.map((i) => i.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'fuelItemsRate', entityType: 'item', data: { text: 'ДДВ гориво артикли → ' + rate + '%: ' + I.length } });
    });
    revalidatePath('/', 'layout');
    return { ok: I.length + ' артикли гориво се со ДДВ ' + rate + '%.' };
  } catch (e) { return actionError(e); }
}
