/**
 * „📦 Пакет за приговор“ (`kontrola.pkg`): the server PDFs the package of a case needs — the submission (the office's
 * saved / accepted text, else the generated one) and every attachment that is a print: outgoing invoices (the invoice
 * template, as `invoice.mail`), the VAT books, the kartica of the konto, ДДВ-04 and the payroll summary
 * (`attachmentPrint` → `attachmentPrintHtml`). Scans that are already in the archive are not rendered.
 * The file ids go to `data.pkg`; the web route `/kontroli/paket` builds the ZIP (Word + PDF + „Прилог NN – …“).
 */
import { attachmentPrintHtml, SUBMISSION_LBL } from '@wise/core/compliance';
import { PDFDOC_CSS } from '@wise/core/print-css';
import { attachmentPrint, finishKontrolaPkg, kontrolaPkgState, kontrolaSubmissionHtml, loadKontrolaCase, type DB, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { readS3File, s3Configured } from '../mail/files';
import type { PdfInput } from '../pdf/document';
import type { ObjectStore } from '../storage';
import { renderInvoicePdf } from './invoice-mail';
import { renderPdfToFile } from './pdf';

export interface KontrolaPkgJob { kid: string; firmId: string; reqId: string; userId?: string | null }
export interface KontrolaPkgDeps { render?: (p: PdfInput) => Promise<Uint8Array>; store?: ObjectStore; readFile?: (bucketKey: string) => Promise<Buffer> }

export async function runKontrolaPkg(db: Tx, j: KontrolaPkgJob, deps: KontrolaPkgDeps = {}): Promise<boolean> {
  try {
    const c = await loadKontrolaCase(db, j.firmId, j.kid);
    if (!c || kontrolaPkgState(c.k)?.reqId !== j.reqId) return false;
    const pdf = (html: string, title: string) => renderPdfToFile(db as unknown as DB, { html, css: PDFDOC_CSS, title, firmId: j.firmId, userId: j.userId ?? null }, { render: deps.render, store: deps.store });
    const S = kontrolaSubmissionHtml(c);
    const doc = await pdf(`<div style="font-family:serif;font-size:11.5pt;line-height:1.45">${S.html}</div>`, `${SUBMISSION_LBL[S.type]} ${c.k.docNo ?? ''}`.trim());
    const rendered: Record<string, string[]> = {};
    const firm = { name: c.firm.name, edb: c.firm.edb };
    const readFile = deps.readFile ?? (s3Configured() ? readS3File : undefined);
    for (const a of c.att) {
      if (!a.render) continue;
      if (a.render.t === 'invoice') {
        const r = await renderInvoicePdf(db as unknown as DB, a.render.id, { mail: { mailer: null, readFile }, render: deps.render, store: deps.store }, { userId: j.userId ?? null, firmId: j.firmId });
        if (r) rendered[a.key] = [r.fileId];
        continue;
      }
      const p = await attachmentPrint(db, j.firmId, a.render);
      if (p) rendered[a.key] = [await pdf(attachmentPrintHtml(p, firm, a.no), `Prilog ${a.no} ${p.title}`)];
    }
    return await db.transaction((tx) => finishKontrolaPkg(tx, j.firmId, j.kid, j.reqId, { status: 'done', doc, hash: S.hash, type: S.type, rendered, error: undefined }));
  } catch (e) {
    await db.transaction((tx) => finishKontrolaPkg(tx, j.firmId, j.kid, j.reqId, { status: 'error', error: ((e as Error).message || String(e)).slice(0, 500) })).catch(() => undefined);
    return false;
  }
}

export const kontrolaPkg = defineJob<KontrolaPkgJob>({
  name: 'kontrola.pkg',
  queue: { retryLimit: 0, expireInSeconds: 15 * 60 },
  async run(data, { db }) {
    if (data?.kid && data.firmId && data.reqId) await runKontrolaPkg(db as unknown as Tx, data);
  },
});
