'use server';
/**
 * Server actions for outgoing documents (Излез, Услуги, Одобренија, Профактури, Испратници): legacy `saveInv`,
 * `delDoc`, approval of client entries, invoice styling settings. Every action is guarded and audited (the services
 * write the audit rows inside the document transaction).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { aiDocuments, approveInvoice, audit, deleteInvoice, fileLinks, firms, markDraftSaved, saveInvoice } from '@wise/db';
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

const STYLE_KEYS = ['invStyle', 'invColor', 'invNote', 'bank', 'bankName', 'signer', 'signerRole', 'short', 'legalFoot', 'logo', 'sign', 'stamp'] as const;

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
  await db().transaction(async (tx) => {
    await tx.update(firms).set({ settings: s }).where(eq(firms.id, firm.id));
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'invStyle', entityType: 'firm', entityId: firm.id, data: ch });
  });
  revalidatePath('/izlez');
}
