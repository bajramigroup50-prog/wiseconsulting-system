'use server';
/**
 * Legacy ACT `opMailGo` / `opMailAll` / `opPdf` / `opWaDone` / `opDays` / `opSet` (13346–13400): every letter is
 * logged (`dunning_letters`) — the next one's level is suggested from them. FIX: the e-mail goes through the mail
 * queue (`mail_log`, Историја на праќања) with the letter itself in the body instead of a browser-made PDF.
 */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { OP_LV, type OpGroup } from '@wise/core/firms/dunning';
import { audit, dunningLetters, partners, textMailHtml, type Tx } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { patchFirmSettings } from '@/lib/firms-office';
import { dispatchMail, queueMail, validAddresses } from '@/lib/mail';
import { officeAction, officeError } from '@/lib/office';
import { letterFor, loadDunning, lvlOk } from './data';

const rev = () => { revalidatePath('/opomeni'); revalidatePath('/mailhist'); };
const CHANNELS = ['PDF', 'WhatsApp/Viber'] as const;

async function logLetter(tx: Tx, a: { firmId: string; userId: string; g: OpGroup; pname: string; lvl: number; channel: string; ids: string[]; total: number; date: string; mailId?: string }) {
  const [d] = await tx.insert(dunningLetters).values({
    firmId: a.firmId, partnerId: a.g.pid === '—' ? null : a.g.pid, partnerName: a.pname, invoiceIds: a.ids, level: a.lvl + 1,
    channel: a.channel, total: (a.total / 100).toFixed(2), date: a.date, mailId: a.mailId ?? null, createdBy: a.userId,
  }).returning({ id: dunningLetters.id });
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'opLog', entityType: 'dunning_letter', entityId: d!.id,
    data: { partner: a.pname, level: a.lvl + 1, channel: a.channel, total: a.total / 100, invoices: a.ids.length } });
}

/** Legacy `opMailGo`: send one letter by e-mail (the user may edit subject and text). */
export async function sendDunning(pid: string, _p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('write');
    const lvl = lvlOk(f.get('lvl'));
    const to = String(f.get('to') ?? '').trim();
    if (!validAddresses(to)) return { error: 'Внесете валидна е-пошта.' };
    const D = await loadDunning(firm);
    const g = D.G.find((x) => x.pid === pid);
    if (!g || g.over <= 0) return { error: 'Купувачот нема достасани неплатени фактури.' };
    const { X, html } = letterFor(D, g, lvl);
    const subject = String(f.get('subject') ?? '').trim().slice(0, 300) || X.subj;
    const body = String(f.get('body') ?? '').trim().slice(0, 20000) || X.body;
    const p = D.pOf(pid);
    const ids = await db().transaction(async (tx) => {
      const mailId = await queueMail(tx, { firmId: firm.id, to, subject, html: textMailHtml(body) + '<hr style="margin:18px 0">' + html, entityType: 'dunning', entityId: pid, userId: u.id });
      await logLetter(tx, { firmId: firm.id, userId: u.id, g, pname: p.name, lvl, channel: 'е-пошта', ids: X.L.map((r) => r.inv.id), total: X.tot, date: D.td, mailId });
      // Legacy: a customer without e-mail gets the address the letter was sent to.
      if (!p.email && pid !== '—') await tx.update(partners).set({ email: to }).where(and(eq(partners.id, pid), eq(partners.firmId, firm.id)));
      return [mailId];
    });
    await dispatchMail(ids);
    rev();
    return { ok: `${OP_LV[lvl]} е испратена на ${to}.` };
  } catch (e) { return officeError(e); }
}

/** Legacy `opMailAll`: the suggested letter to every overdue customer that has an e-mail. */
export async function sendDunningAll(): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('write');
    const D = await loadDunning(firm);
    const G = D.G.filter((g) => g.over > 0 && D.pOf(g.pid).email && validAddresses(D.pOf(g.pid).email!));
    if (!G.length) return { error: 'Нема купувачи со е-пошта и достасани фактури.' };
    const ids = await db().transaction(async (tx) => {
      const out: string[] = [];
      for (const g of G) {
        const lvl = g.lvlAuto;
        const { X, html } = letterFor(D, g, lvl);
        const p = D.pOf(g.pid);
        const mailId = await queueMail(tx, { firmId: firm.id, to: p.email!, subject: X.subj, html: textMailHtml(X.body) + '<hr style="margin:18px 0">' + html, entityType: 'dunning', entityId: g.pid, userId: u.id });
        await logLetter(tx, { firmId: firm.id, userId: u.id, g, pname: p.name, lvl, channel: 'е-пошта', ids: X.L.map((r) => r.inv.id), total: X.tot, date: D.td, mailId });
        out.push(mailId);
      }
      return out;
    });
    await dispatchMail(ids);
    rev();
    return { ok: `Испратени ${ids.length} опомени.` };
  } catch (e) { return officeError(e); }
}

/** Legacy `opPdf` / `opWaDone`: remember a letter printed as PDF or sent through WhatsApp / Viber. */
export async function logDunning(pid: string, lvl0: number, channel: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('write');
    if (!(CHANNELS as readonly string[]).includes(channel)) return { error: 'Непознат канал.' };
    const lvl = lvlOk(lvl0);
    const D = await loadDunning(firm);
    const g = D.G.find((x) => x.pid === pid);
    if (!g) return { error: 'Купувачот нема отворени фактури.' };
    const { X } = letterFor(D, g, lvl);
    if (!X.L.length) return { error: 'Нема достасани фактури за опомена.' };
    await db().transaction((tx) => logLetter(tx, { firmId: firm.id, userId: u.id, g, pname: D.pOf(pid).name, lvl, channel, ids: X.L.map((r) => r.inv.id), total: X.tot, date: D.td }));
    rev();
    return { ok: 'Запаметено.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `opDays` + `opSet` (ACT_NEED `settings`): payment days for invoices without a due date, late interest, letter cost. */
export async function saveDunningSettings(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('settings');
    const n = (k: string) => { const s = String(f.get(k) ?? '').trim().replace(',', '.'); const v = Number(s); return s === '' ? 0 : Number.isFinite(v) && v >= 0 ? v : NaN; };
    const payDays = Math.floor(n('payDays')), opRate = n('opRate'), opCost = n('opCost');
    if (!(payDays >= 0) || !(opRate >= 0 && opRate <= 100) || !(opCost >= 0)) return { error: 'Внесете броеви (денови, %, денари).' };
    await db().transaction(async (tx) => {
      await patchFirmSettings(tx, firm.id, { payDays, opRate: String(opRate), opCost: String(opCost) });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'opSet', entityType: 'firm', entityId: firm.id, data: { payDays, opRate, opCost } });
    });
    rev();
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}
