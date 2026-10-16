'use server';
/**
 * „📊 Месечен извештај за клиентот“ — office actions. Numbers are computed from the books (free, `saveClientReport`);
 * „💲 AI“ queues the optional summary for the worker (`client-report.summary`) after checking the monthly AI limit;
 * „Објави“ shows the report in the client's portal (`/klIzv`) with a portal message; „Испрати“ e-mails it as a PDF
 * (only with SMTP configured). „Подготви за сите клиенти“ is the office owner's batch. Every change: `requireCan('office',
 * firm)` on the report's own firm + `audit_log`.
 * 🎭 A demo user: its reports are of demo firms only (`requireCan` on the report's firm = the demo firms), the batch is
 * the demo office owner's (a demo admin) over the demo firms, and nothing is e-mailed (`refuseDemo`).
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { CLIENT_REPORT_AI_JOB, clientReportHtml, isReportLang, isReportPeriod, klLang, periodLabel, type ClientReportData, type KlConfig } from '@wise/core/office';
import { aiBudgetStatus, audit, clientReports, firmMail, firms, publishClientReport, publishPreparedReports, saveClientReport, textMailHtml, type Firm } from '@wise/db';
import { requireCan, requireUser } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { smtpConfigured, splitAddresses, validAddresses } from '@/lib/mail';
import { allowedFirms, fv, isUuid, officeAction, officeError, today } from '@/lib/office';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { refuseDemo } from '@/lib/demo';
import { ownerContext } from '@/lib/demo-office';
import { dispatchPdfMail, pdfFileTitle, queuePdfMail } from '@/lib/pdf-mail';

const langOf = (f: Pick<Firm, 'settings'>) => klLang((f.settings as { kl?: KlConfig }).kl);
const done = (ok: string): ActionState => { revalidatePath('/mesIzv'); revalidatePath('/klIzv'); return { ok }; };

/** A period that has started (no reports for future months). */
function periodOk(p: string | null): p is string {
  return isReportPeriod(p) && p <= today().slice(0, 7);
}

/** „Пресметај“: (re)compute the report of the current firm for a month. */
export async function prepareReport(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const period = fv(f, 'period');
    if (!periodOk(period)) return { error: 'Изберете месец (не во иднина).' };
    const r = await db().transaction(async (tx) => {
      const r = await saveClientReport(tx, { firmId: firm.id, period, userId: u.id, lang: langOf(firm) });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'crPrep', entityType: 'client_report', entityId: r.id, data: { period, changed: r.changed } });
      return r;
    });
    return done(r.created ? `Извештајот за ${periodLabel(period)} е пресметан.` : r.changed ? 'Бројките се освежени (AI прегледот е избришан – стар е).' : 'Нема промени во бројките.');
  } catch (e) { return officeError(e); }
}

/** „Подготви за сите клиенти“ (office owner): the month's report for every active firm the owner sees. */
export async function prepareAll(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireUser();
    const c = await ownerContext(u);
    if (!c) return { error: OWNER_ONLY_MSG };
    // the real owner: the office-wide permission; 🎭 the demo office's owner: its demo firms only (`allowedFirms` by side)
    if (!c.demo) await requireCan('office', null);
    const period = fv(f, 'period');
    if (!periodOk(period)) return { error: 'Изберете месец (не во иднина).' };
    const F = (await allowedFirms(u)).filter((x) => x.active);
    let n = 0;
    const bad: string[] = [];
    for (const firm of F) {
      try {
        await db().transaction(async (tx) => {
          const r = await saveClientReport(tx, { firmId: firm.id, period, userId: u.id, lang: langOf(firm) });
          await audit(tx, { userId: u.id, firmId: firm.id, action: 'crPrep', entityType: 'client_report', entityId: r.id, data: { period, batch: true, changed: r.changed } });
        });
        n++;
      } catch (e) { bad.push(`${firm.name}: ${(e as Error).message}`); }
    }
    revalidatePath('/mesIzv');
    return bad.length ? { error: `Подготвени ${n} од ${F.length}. Грешки: ${bad.slice(0, 5).join('; ')}` } : { ok: `Подготвени извештаи за ${periodLabel(period)}: ${n} фирми.` };
  } catch (e) { return officeError(e); }
}

async function loadFor(id: string) {
  if (!isUuid(id)) return null;
  const [r] = await db().select().from(clientReports).where(eq(clientReports.id, id)).limit(1);
  if (!r) return null;
  const u = await requireCan('office', r.firmId);
  return { r, u };
}

/** „💲 AI“: queue the plain-language summary (the client's language) — refused while the monthly AI limit is reached. */
export async function reportAi(id: string): Promise<ActionState> {
  try {
    const x = await loadFor(id);
    if (!x) return { error: 'Извештајот не постои.' };
    const { r, u } = x;
    if (r.aiStatus === 'queued') return { ok: 'AI прегледот веќе се пишува…' };
    const b = await aiBudgetStatus(db(), r.firmId);
    if (b.paused) return { error: `AI е паузиран: ${b.msg}` };
    const [firm] = await db().select().from(firms).where(eq(firms.id, r.firmId)).limit(1);
    const lang = firm ? langOf(firm) : 'mk';
    await db().transaction(async (tx) => {
      await tx.update(clientReports).set({ aiStatus: 'queued', aiError: null, lang }).where(eq(clientReports.id, r.id));
      await audit(tx, { userId: u.id, firmId: r.firmId, action: 'crAi', entityType: 'client_report', entityId: r.id, data: { lang } });
    });
    try { await enqueue(CLIENT_REPORT_AI_JOB, { id: r.id }); } catch {
      await db().update(clientReports).set({ aiStatus: 'error', aiError: 'Редот за задачи е недостапен – обидете се повторно.' }).where(eq(clientReports.id, r.id));
      return { error: 'Редот за задачи е недостапен – обидете се повторно.' };
    }
    return done('💲 AI го пишува прегледот (неколку секунди)…');
  } catch (e) { return officeError(e); }
}

/** Show / hide the report in the client's portal (showing it also leaves a portal message for the client). */
export async function publishReport(id: string, on: boolean): Promise<ActionState> {
  try {
    const x = await loadFor(id);
    if (!x) return { error: 'Извештајот не постои.' };
    const { r, u } = x;
    await db().transaction(async (tx) => {
      if (on) { await publishClientReport(tx, r, { id: u.id, name: u.name }); return; }
      await tx.update(clientReports).set({ status: 'draft', publishedAt: null }).where(eq(clientReports.id, r.id));
      await audit(tx, { userId: u.id, firmId: r.firmId, action: 'crHide', entityType: 'client_report', entityId: r.id });
    });
    return done(on ? 'Извештајот е видлив во порталот на клиентот.' : 'Извештајот е сокриен од клиентот.');
  } catch (e) { return officeError(e); }
}

/** E-mail the report as a PDF (worker `pdf.mail`) — only when SMTP is set up; also publishes it in the portal. */
export async function mailClientReport(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    await refuseDemo(undefined, 'crMail');
    if (!smtpConfigured()) return { error: 'Е-пошта не е поставена на серверот (SMTP).' };
    const x = await loadFor(fv(f, 'id') ?? '');
    if (!x) return { error: 'Извештајот не постои.' };
    const { r, u } = x;
    const [firm] = await db().select().from(firms).where(eq(firms.id, r.firmId)).limit(1);
    const to = splitAddresses(fv(f, 'to') ?? (await firmMail(db(), r.firmId)) ?? '');
    if (!validAddresses(to)) return { error: 'Внесете е-пошта на клиентот.' };
    const lang = isReportLang(r.lang) ? r.lang : 'mk';
    const html = clientReportHtml(r.data as unknown as ClientReportData, { firm: firm?.name ?? '', lang, summary: r.summary, by: u.name });
    const pl = periodLabel(r.period, lang);
    const body = lang === 'sq'
      ? `Të nderuar,\n\nNë shtojcë është raporti mujor i ${firm?.name ?? ''} për ${pl}.\n\nMe respekt,\n${u.name}`
      : `Почитувани,\n\nВо прилог е месечниот извештај на ${firm?.name ?? ''} за ${pl}.\n\nСо почит,\n${u.name}`;
    const jobs = await db().transaction(async (tx) => {
      const job = await queuePdfMail(tx, {
        firmId: r.firmId, to, subject: `${lang === 'sq' ? 'Raport mujor' : 'Месечен извештај'} – ${firm?.name ?? ''} – ${pl}`, html: textMailHtml(body),
        entityType: 'client_report', entityId: r.id, userId: u.id,
      }, { html: `<div class="pdfdoc">${html}</div>`, title: pdfFileTitle('Mesecen_izvestaj', r.period) });
      await tx.update(clientReports).set({ status: 'sent', sentAt: new Date(), sentTo: to.join(', '), publishedAt: r.publishedAt ?? new Date() }).where(eq(clientReports.id, r.id));
      await audit(tx, { userId: u.id, firmId: r.firmId, action: 'crMail', entityType: 'client_report', entityId: r.id, data: { to, mailId: job.logId } });
      return [job];
    });
    const failed = await dispatchPdfMail(jobs);
    revalidatePath('/mailhist');
    if (failed) return { error: 'Редот за PDF е недостапен – пораката чека; проверете во „Историја на праќања“.' };
    return done(`✓ Извештајот (PDF) се испраќа на ${to.join(', ')}.`);
  } catch (e) { return officeError(e); }
}

/**
 * P38 „📢 Објави ги сите подготвени“ (office owner): every report of the month still in draft — the scheduled job's and
 * the ones prepared by hand — is shown in its client's portal (with the portal message). Audited per report
 * (`crPublish`) and as a batch (`crPublishAll`). 🎭 The demo owner: the demo firms only.
 */
export async function publishAllPrepared(period: string): Promise<ActionState> {
  try {
    const u = await requireUser();
    const c = await ownerContext(u);
    if (!c) return { error: OWNER_ONLY_MSG };
    if (!c.demo) await requireCan('office', null);
    if (!periodOk(period)) return { error: 'Изберете месец (не во иднина).' };
    const ids = (await allowedFirms(u)).filter((x) => x.active).map((x) => x.id);
    const n = await publishPreparedReports(db(), { period, firmIds: ids, user: { id: u.id, name: u.name } });
    revalidatePath('/mesIzv');
    revalidatePath('/klIzv');
    return n ? { ok: `📢 Објавени ${n} извештаи за ${periodLabel(period)} во порталите на клиентите.` } : { error: 'Нема подготвени извештаи за објава.' };
  } catch (e) { return officeError(e); }
}
