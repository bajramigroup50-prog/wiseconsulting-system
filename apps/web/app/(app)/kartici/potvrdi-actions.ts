'use server';
/**
 * „📨 Потврди на салдо – сите“ (legacy v434 13834–13854, `paRun`): balance confirmations to every selected partner by
 * e-mail with the confirmation PDF (and optionally the partner's card) attached; e-mail addresses edited in the list are
 * saved on the partner. Archiving into the dossier is handled with the reconciliation archive (other module).
 */
import { revalidatePath } from 'next/cache';
import { createElement, Fragment } from 'react';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { audit, partners, textMailHtml } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { validAddresses } from '@/lib/mail';
import { dispatchPdfMail, pdfFileTitle, queuePdfMail } from '@/lib/pdf-mail';
import { PotvrdaDoc } from '../../print/fin/potvrda-doc';
import { confirmationList } from './potvrdi-data';

export async function savePartnerEmailAction(pid: string, email: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    const e = email.trim();
    if (e && !validAddresses(e)) return { error: 'Неважечка е-пошта.' };
    await db().transaction(async (tx) => {
      const [p] = await tx.update(partners).set({ email: e || null }).where(and(eq(partners.id, pid), eq(partners.firmId, firm.id))).returning({ id: partners.id });
      if (p) await audit(tx, { userId: u.id, firmId: firm.id, action: 'savePartner', entityType: 'partner', entityId: pid, data: { email: e } });
    });
    revalidatePath('/kartici/potvrdi');
    return { ok: 'Зачувано.' };
  } catch (e) { return actionError(e); }
}

const SendIn = z.object({ to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ids: z.array(z.uuid()).max(2000), card: z.boolean() });

export async function sendConfirmationsAction(input: z.input<typeof SendIn>): Promise<ActionState> {
  try {
    const v = SendIn.parse(input);
    const { u, firm, year } = await firmAction('write');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { list, lines } = await confirmationList(firm.id, year, v.to);
    const want = new Set(v.ids);
    const L = list.filter((x) => want.has(x.pid));
    const s = (firm.settings ?? {}) as { short?: string; signer?: string };
    const today = new Date().toISOString().slice(0, 10);
    const dl = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10);
    const skip: string[] = [];
    const jobs = await db().transaction(async (tx) => {
      const out: Awaited<ReturnType<typeof queuePdfMail>>[] = [];
      for (const x of L) {
        if (!x.email || !validAddresses(x.email)) { skip.push(x.name); continue; }
        // the confirmation, and the partner's card on the next page (legacy attached it as a second PDF)
        const card = v.card ? lines.filter((l) => l.partnerId === x.pid) : [];
        const html = renderToStaticMarkup(createElement('div', { className: 'pdfdoc' },
          createElement(PotvrdaDoc, { firm, p: x.p!, R: x.R, to: v.to, today }),
          card.length ? createElement(Fragment, null,
            createElement('div', { className: 'pb' }),
            createElement('h2', null, `КАРТИЦА НА КОМИТЕНТ – ${x.name} · до ${dmy(v.to)}`),
            createElement('table', null,
              createElement('thead', null, createElement('tr', null, ...['Датум', 'Конто', 'Документ', 'Должи', 'Побарува'].map((t) => createElement('th', { key: t }, t)))),
              createElement('tbody', null, ...card.map((l, i) => createElement('tr', { key: i },
                createElement('td', null, dmy(l.date)), createElement('td', null, l.account), createElement('td', null, [l.description, l.doc].filter(Boolean).join(' · ')),
                createElement('td', { className: 'n' }, l.debit ? fmt(l.debit) : ''), createElement('td', { className: 'n' }, l.credit ? fmt(l.credit) : '')))))) : null));
        const body = `Почитувани,\n\nСогласно член 483, став 3 од Законот за трговските друштва, во прилог Ви ја доставуваме потврдата за состојбата на салдата на ден ${dmy(v.to)}${v.card ? ' и картицата од нашата евиденција' : ''}.\n${x.nz.map((r) => '• ' + r.s + ' ' + r.n + ': ' + fmt(Math.abs(r.v)) + ' ден.').join('\n')}\n\nВе молиме потврдата да ја вратите потпишана на оваа е-пошта најдоцна до ${dmy(dl)}. Доколку постои разлика, Ве молиме наведете ја и пратете ни ја Вашата картица.\n\nСо почит,\n${s.signer ?? ''}\n${firm.name}${firm.phone ? '\nТел.: ' + firm.phone : ''}`;
        out.push(await queuePdfMail(tx, {
          firmId: firm.id, to: x.email, subject: `Потврда за состојба на салда на ден ${dmy(v.to)} – ${s.short || firm.name}`, html: textMailHtml(body),
          entityType: 'potvrda', entityId: x.pid, userId: u.id,
        }, { html, title: pdfFileTitle('Potvrda_saldo', x.name) }));
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'paSend', entityType: 'potvrda', data: { to: v.to, sent: out.length, skipped: skip.length } });
      return out;
    });
    await dispatchPdfMail(jobs);
    revalidatePath('/kartici/potvrdi');
    return { ok: `✓ Испратени: ${jobs.length}${skip.length ? ` · без е-пошта (не се испратени): ${skip.join(', ')}` : ''}.` };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: 'Неважечки податоци.' };
    return actionError(e);
  }
}
