'use server';
/**
 * Server actions for outgoing documents (Излез, Услуги, Одобренија, Профактури, Испратници): legacy `saveInv`,
 * `delDoc`, approval of client entries, invoice styling settings. Every action is guarded and audited (the services
 * write the audit rows inside the document transaction).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { isFuel } from '@wise/core/sales';
import { z } from 'zod';
import { aiDocuments, approveInvoice, audit, createInvoiceNalog, deleteInvoice, draftSourceFiles, fileLinks, firms, invoices, items, markDraftSaved, markInvoicesVat, saveInvoice } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { actorOf } from '@/lib/sales';
import { scanEditorHref, scanQueue } from '@/lib/scan-queue';
import { nextCode } from '@/lib/codes';

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
  // header-first workflow: „Креирај фактура“ / „💾 Зачувај нацрт“ save an unbooked draft and reopen it in the editor
  draft: z.boolean().optional(),
  production: z.object({
    wh: z.string().max(40).nullable(), extra: str, saveBom: z.boolean(),
    // „🏭 Фактура од производство“ and its „Работен налог / период“
    mode: z.enum(['prodInv']).nullable().optional(),
    workOrder: z.object({ number: z.string().trim().max(40), from: date.nullable(), to: date.nullable() }).nullable().optional(),
    // one entry per line marked „🏭 производство“, with its own materials warehouse, extra costs and „зачувај како норматив“
    lines: z.array(z.object({
      lineNo: z.number().int().min(0), productId: z.uuid(), qty: str, materials: z.array(z.object({ itemId: z.uuid(), qty: str })).max(200),
      wh: z.string().max(40).nullable().optional(), extra: str.optional(), saveBom: z.boolean().optional(),
      // main product of a production invoice: specification / dimensions and cost elements
      main: z.boolean().optional(),
      spec: z.object({ text: z.string().max(500), l: str, w: str, h: str, mode: z.enum(['', 'm', 'm2', 'm3']), pcs: str }).nullable().optional(),
      calc: z.object({
        hours: str, rate: str, labour: str, ovhPct: str,
        other: z.array(z.object({ label: z.string().max(80), amount: str })).max(30),
      }).nullable().optional(),
    })).max(200),
  }).nullable().optional(),
});

/** List view of a document kind. */
const viewOf = (kind: string, svc: boolean) => ({ credit: 'odobrenija', proforma: 'profakturi', dispatch: 'ispratnici' })[kind] ?? (svc ? 'uslugi' : 'izlez');

export async function saveInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let target = '';
  try {
    const p = Payload.safeParse(JSON.parse(String(form.get('payload') ?? '{}')));
    if (!p.success) return { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = p.data;
    // the submit button pressed: „Креирај фактура“ / „💾 Зачувај нацрт“ (draft) or „Зачувај и прокнижи“
    const asDraft = v.kind === 'invoice' && (form.get('asDraft') === '1' || !!v.draft);
    const { u, firm } = await firmAction(v.id ? 'editInv' : 'saveInv');
    const res = await db().transaction(async (tx) => {
      const r = await saveInvoice(tx, firm.id, {
        ...v, lines: v.lines.map((l) => ({ ...l, itemId: l.itemId || null })), partnerId: v.partnerId || null, warehouseId: v.warehouseId || null,
        refInvoiceId: v.refInvoiceId || null, fromDocId: v.fromDocId || null, scanned: !!v.scanDocId,
        production: v.production ? {
          ...v.production, wh: v.production.wh || null,
          lines: v.production.lines.map((l) => ({ ...l, ...(l.wh !== undefined ? { wh: l.wh || null } : {}), ...(l.extra !== undefined ? { extra: l.extra || '0' } : {}) })),
        } : null,
        advances: v.advances.filter((a) => Number(a.amount) > 0),
        data: v.data, draft: asDraft,
      }, actorOf(u));
      if (v.scanDocId != null && v.scanIndex != null) {
        await markDraftSaved(tx, firm.id, v.scanDocId, v.scanIndex, r.id);
        // the scanned original stays attached to the invoice (legacy `outDraft` files: [att])
        // the source file (photos read together: only the photos of this invoice's pages); a file with several
        // invoices is linked to each of them
        const [ad] = await tx.select().from(aiDocuments).where(and(eq(aiDocuments.id, v.scanDocId), eq(aiDocuments.firmId, firm.id))).limit(1);
        const src = ad ? draftSourceFiles(ad, v.scanIndex).fileIds : [];
        if (src.length) await tx.insert(fileLinks).values(src.map((fileId) => ({ fileId, entityType: 'invoice', entityId: r.id, role: 'source' }))).onConflictDoNothing();
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
    // a draft opens again „from inside“: lines, main products, calculation, then „Зачувај и прокнижи“
    if (asDraft && res.status === 'draft' && v.scanDocId == null) {
      const e = new URLSearchParams({ edit: res.id, drafted: '1' });
      if (res.warnings.length) e.set('w', res.warnings.join(' | ').slice(0, 1500));
      if (v.back && /^\/[a-zA-Z]/.test(v.back)) e.set('back', v.back);
      target = '/' + viewOf(v.kind, v.svc) + '?' + e.toString();
    }
    // legacy `outSaveOne` / scan queue: the next scanned invoice of the run opens automatically
    if (v.scanDocId != null && v.scanIndex != null) {
      const Q = await scanQueue(firm.id, v.scanDocId, v.scanIndex);
      if (Q?.next) target = (await scanEditorHref(firm.id, Q.next, back)) + '&prevSaved=' + res.id;
    }
  } catch (e) { return actionError(e); }
  revalidatePath('/', 'layout');
  redirect(target);
}

const NewNalog = z.object({
  number: z.string().trim().max(40), date: date.refine((s) => !!s, 'Внесете датум на налогот.'),
  description: z.string().trim().max(200), periodFrom: date, periodTo: date,
});

/**
 * „+ Креирај налог“ in the invoice header: open a collective sale nalog (e.g. „Излезни фактури 10/2026“) into which
 * several invoices are booked. Needs `write` (like a manual nalog); audited `newNalog` by the posting service.
 */
export async function createInvoiceNalogAction(input: z.input<typeof NewNalog>): Promise<ActionState & { nalog?: { number: string; description: string; periodFrom: string | null; periodTo: string | null; date: string } }> {
  try {
    const p = NewNalog.safeParse(input);
    if (!p.success) return { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = p.data;
    const { u, firm } = await firmAction('write');
    const r = await db().transaction((tx) => createInvoiceNalog(tx, firm, { number: v.number || null, date: v.date, description: v.description || null, periodFrom: v.periodFrom || null, periodTo: v.periodTo || null }, u.id));
    revalidatePath('/nalozi');
    return {
      ok: `Креиран е налогот бр. ${r.number} – фактурата ќе се книжи во него.`,
      nalog: { number: r.number, description: v.description || `Излезни фактури ${v.date.slice(5, 7)}/${v.date.slice(0, 4)}`, periodFrom: v.periodFrom || null, periodTo: v.periodTo || null, date: v.date },
    };
  } catch (e) { return actionError(e); }
}

/** Delete a document (needs `del`, like legacy `delOk`). */
export async function deleteInvoiceAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    const r = await db().transaction((tx) => deleteInvoice(tx, firm.id, id, actorOf(u)));
    revalidatePath('/', 'layout');
    // retention lock: an issued invoice inside the series is cancelled (сторно) — it keeps its number
    return { ok: r.cancelled ? 'Фактурата е издадена и не е последна по ред – сторнирана е (бројот се чува, книжењето е поништено).' : 'Документот е избришан.' };
  } catch (e) { return actionError(e); }
}

/** Approve a client-submitted document and book it. */
export async function approveInvoiceAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    const n = await db().transaction(async (tx) => {
      await approveInvoice(tx, firm.id, id, actorOf(u));
      return (await tx.select({ n: invoices.number }).from(invoices).where(eq(invoices.id, id)).limit(1))[0]?.n ?? '';
    });
    revalidatePath('/', 'layout');
    return { ok: `Документот е прокнижен (бр. ${n}).` };
  } catch (e) { return actionError(e); }
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
    let n = 0, c = 0;
    // highest numbers first: each one is then the last of its series and is deleted, not cancelled (retention lock)
    const ord = L.length ? await db().select({ id: invoices.id, date: invoices.date, number: invoices.number }).from(invoices).where(and(eq(invoices.firmId, firm.id), inArray(invoices.id, L))) : [];
    const key = (x: { number: string }) => Number((/\d+/.exec(x.number) ?? ['0'])[0]);
    ord.sort((a, b) => b.date.slice(0, 4).localeCompare(a.date.slice(0, 4)) || key(b) - key(a));
    for (const { id } of ord) { try { const r = await db().transaction((tx) => deleteInvoice(tx, firm.id, id, actorOf(u))); if (r.cancelled) c++; else n++; } catch { /* locked / linked: skipped */ } }
    await db().transaction((tx) => audit(tx, { userId: u.id, firmId: firm.id, action: 'bulkDelete', entityType: 'invoice', data: { text: `Масовно бришење (излез): ${n} избришани, ${c} сторнирани од ${L.length}` } }));
    revalidatePath('/', 'layout');
    return { ok: 'Избришани ' + n + (c ? `, сторнирани ${c} (издадени, не се последни по ред – бројот се чува)` : '') + ' од ' + L.length + (n + c < L.length ? ' – останатите не може (заклучен период или поврзани документи).' : '.') };
  } catch (e) { return actionError(e); }
}

/**
 * „Означи како чл. 32-а“ / „Означи како ослободено“ on the ticked issued invoices without VAT (`markInvoicesVat`):
 * needs the correction right (`fix`: admin), open periods only, every invoice audited.
 */
export async function markInvoicesVatAction(ids: string[], mode: 'art32' | 'ded' | 'noded', note?: string): Promise<ActionState> {
  try {
    const m = mode === 'art32' || mode === 'ded' || mode === 'noded' ? mode : null;
    if (!m) return { error: 'Непознат вид.' };
    const { u, firm } = await firmAction(m === 'art32' ? 'vatMark32' : 'vatMarkExempt');
    const L = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 2000);
    if (!L.length) return { error: 'Изберете фактури (кутичката лево).' };
    const r = await db().transaction((tx) => markInvoicesVat(tx, firm.id, L, m, actorOf(u), { note: String(note ?? '').slice(0, 500) }));
    revalidatePath('/', 'layout');
    const what = m === 'art32' ? 'како чл. 32-а (поле 11, купувачи 1200009)' : m === 'noded' ? 'како ослободени без право на одбивка (поле 09)' : 'како ослободени со право на одбивка (поле 08)';
    const sk = r.skipped.length ? ` Прескокнати ${r.skipped.length}: ${r.skipped.slice(0, 6).map((x) => `${x.number} – ${x.why}`).join('; ')}${r.skipped.length > 6 ? '…' : ''}` : '';
    return r.changed.length ? { ok: `Означени ${r.changed.length} фактури ${what} и повторно прокнижени.${sk}` } : { error: `Ниедна фактура не е изменета.${sk}` };
  } catch (e) { return actionError(e); }
}

const NewProduct = z.object({
  name: z.string().trim().min(1, 'Внесете назив на производот.').max(500), unit: z.string().trim().max(20),
  rate: z.coerce.number().refine((r) => [18, 10, 5, 0].includes(r), 'ДДВ стапка: 18, 10, 5 или 0.'), price: str,
});

/**
 * „+ Креирај производ“ on an invoice line marked „🏭 производство“ that is still free text: the finished-product
 * article (type product, the line's name / unit / VAT / price) is made without leaving the invoice. An existing
 * product with the same name is reused. Guarded by `write`, audited like a new item (`newS`).
 */
export async function createProductAction(input: z.input<typeof NewProduct>): Promise<ActionState & { item?: { id: string; code: string | null; name: string; unit: string | null; price: number; rate: number; type: string; account: string | null; barcodes: string[]; sp: Record<string, number> } }> {
  try {
    const p = NewProduct.safeParse(input);
    if (!p.success) return { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = p.data;
    const { u, firm } = await firmAction('write');
    const it = await db().transaction(async (tx) => {
      const [same] = await tx.select().from(items).where(and(eq(items.firmId, firm.id), eq(items.type, 'product'), sql`lower(${items.name}) = lower(${v.name})`)).limit(1);
      if (same) return { row: same, created: false };
      const code = nextCode((await tx.select({ c: items.code }).from(items).where(eq(items.firmId, firm.id))).map((r) => r.c));
      const price = Number(v.price) > 0 ? String(Math.round(Number(v.price) * 1e4) / 1e4) : null;
      const [row] = await tx.insert(items).values({ firmId: firm.id, code, name: v.name, type: 'product', unit: v.unit || 'ком', vatRate: v.rate, price }).returning();
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'newS', entityType: 'item', entityId: row!.id, data: { name: v.name, code, type: 'product', from: 'invoice' } });
      return { row: row!, created: true };
    });
    revalidatePath('/artikli');
    const r = it.row;
    return {
      ok: it.created ? `Креиран е производот „${r.name}“ (шифра ${r.code ?? ''}).` : `Производот „${r.name}“ веќе постои – поврзан е.`,
      item: { id: r.id, code: r.code, name: r.name, unit: r.unit, price: Number(r.price ?? 0), rate: r.vatRate, type: r.type, account: r.revenueAccount, barcodes: [], sp: {} },
    };
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
