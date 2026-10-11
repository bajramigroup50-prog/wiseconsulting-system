import 'server-only';
/**
 * Legacy „🔔 Автоматски известувања по изводот“ (`pnCfg` / `pnRun` / `pnCard` 13306–13325): when a statement line is
 * linked to one of our invoices (inflow, ≤ 45 days old), the customer gets a payment confirmation by e-mail and the
 * office a summary. Sent through the mail queue (`mail_log`); each notified line is marked in `bank_lines.data.paynote`
 * (legacy `docs` type `paynote`), the last run is kept in `firms.settings.pnLast`.
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { openAmount } from '@wise/core';
import { payNoteCfg, payNoteMail, payNoteSummary, type PayNoteItem } from '@wise/core/bank/parity';
import { audit, bankLines, firms, invoices, loadBankEnv, matchContext, partners, textMailHtml, type Firm } from '@wise/db';
import { db } from '@/lib/db';
import { dispatchMail, queueMail } from '@/lib/mail';

export interface PnLast { at: string; txt: string; n: number; tot: number; sent: number; mailed?: string }

export async function runPayNotes(firm: Firm, userId: string | null, year: number): Promise<void> {
  const s = (firm.settings ?? {}) as Record<string, unknown>;
  const cfg = payNoteCfg(s.autoNotify);
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  const ids: string[] = [];
  await db().transaction(async (tx) => {
    const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, firm.id), eq(bankLines.refType, 'invoice'), gte(bankLines.date, since),
      sql`${bankLines.amount} > 0`, sql`not (${bankLines.data} ? 'paynote')`));
    if (!L.length) return;
    const inv = await tx.select({ id: invoices.id, number: invoices.number, date: invoices.date, partnerId: invoices.partnerId }).from(invoices)
      .where(and(eq(invoices.firmId, firm.id), inArray(invoices.id, [...new Set(L.map((l) => l.refId!).filter(Boolean))])));
    if (!inv.length) return;
    const P = await tx.select({ id: partners.id, name: partners.name, email: partners.email }).from(partners)
      .where(inArray(partners.id, [...new Set(inv.map((i) => i.partnerId).filter((x): x is string => !!x))]));
    const env = await loadBankEnv(tx, firm.id);
    const ctx = await matchContext(tx, env, year);
    const Q: PayNoteItem[] = [];
    for (const l of L) {
      const i = inv.find((x) => x.id === l.refId);
      if (!i) continue;
      const p = P.find((x) => x.id === i.partnerId);
      const doc = ctx.invoices.find((d) => d.id === i.id);
      const q: PayNoteItem = {
        invNo: i.number, invDate: i.date, partner: p?.name ?? '', email: p?.email ?? '', date: l.date,
        amt: Math.round(Math.abs(Number(l.settle ?? l.amount)) * 100), open: doc ? openAmount(ctx.rows, 'invoice', doc) : 0,
      };
      if (cfg.pay && q.email) {
        const m = payNoteMail(q, { name: firm.name, short: (s.short as string) ?? null, signer: (s.signer as string) ?? null, phone: firm.phone });
        ids.push(await queueMail(tx, { firmId: firm.id, to: q.email, subject: m.subject, html: textMailHtml(m.body), entityType: 'bank_line', entityId: l.id, userId }));
        q.ok = true;
      } else q.why = !cfg.pay ? 'исклучено' : 'без е-пошта';
      Q.push(q);
      await tx.update(bankLines).set({ data: sql`${bankLines.data} || ${JSON.stringify({ paynote: { sent: !!q.ok, to: q.ok ? q.email : '', at: new Date().toISOString() } })}::jsonb` }).where(eq(bankLines.id, l.id));
    }
    if (!Q.length) return;
    const sum = payNoteSummary(Q, { name: firm.name, short: (s.short as string) ?? null }, today);
    const last: PnLast = { at: new Date().toISOString(), txt: sum.body, n: Q.length, tot: sum.total, sent: Q.filter((q) => q.ok).length };
    if (cfg.sum && cfg.to) {
      ids.push(await queueMail(tx, { firmId: firm.id, to: cfg.to, subject: sum.subject, html: textMailHtml(sum.body), entityType: 'firm', entityId: firm.id, userId }));
      last.mailed = cfg.to;
    }
    const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id)).limit(1);
    await tx.update(firms).set({ settings: { ...((f?.settings ?? {}) as Record<string, unknown>), pnLast: last } }).where(eq(firms.id, firm.id));
    await audit(tx, { userId, firmId: firm.id, action: 'pnRun', entityType: 'firm', entityId: firm.id, data: { n: Q.length, sent: last.sent, mailed: last.mailed ?? null } });
  });
  await dispatchMail(ids);
}
