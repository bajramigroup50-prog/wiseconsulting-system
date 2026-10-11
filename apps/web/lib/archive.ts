import 'server-only';
/** Server side of legacy `archRows`: the firm's files grouped by the document they are attached to (`file_links`). */
import { and, eq, inArray, ne } from 'drizzle-orm';
import { archSort, type ArchRow } from '@wise/core/office/archive';
import {
  aiDocuments, bankAccounts, bankStatements, cashVouchers, dossierDocs, employees, fileLinks, files, firms, invoices, journals, mpinAcks, mpinInbox,
  partners, purchases, wordTemplates, OFFICE_FILE_ENTITY, type Tx,
} from '@wise/db';
import { db } from './db';

/** Firm settings keys holding the invoice images (`files.id`), see /firmi. */
export const FIRM_IMAGE_KEYS = ['logo', 'sign', 'stamp'] as const;
const firmImages = (settings: unknown) => {
  const S = (settings ?? {}) as Record<string, unknown>;
  return new Set(FIRM_IMAGE_KEYS.map((k) => S[k]).filter((v): v is string => typeof v === 'string'));
};

const INV_HREF: Record<string, string> = { invoice: '/izlez', credit: '/odobrenija', proforma: '/profakturi', dispatch: '/ispratnici' };

export async function archRows(firmId: string): Promise<ArchRow[]> {
  const F = await db().select({ id: files.id, name: files.name, mime: files.mime, at: files.createdAt }).from(files)
    .where(and(eq(files.firmId, firmId), eq(files.status, 'ready')));
  if (!F.length) return [];
  const byId = new Map(F.map((f) => [f.id, f]));
  const L = await db().select().from(fileLinks).where(inArray(fileLinks.fileId, F.map((f) => f.id)));
  const ids = (t: string) => [...new Set(L.filter((l) => l.entityType === t).map((l) => l.entityId))].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const [P, I, D, E, C, J] = await Promise.all([
    ids('purchase').length ? db().select({ p: purchases, pn: partners.name }).from(purchases).leftJoin(partners, eq(partners.id, purchases.partnerId)).where(and(eq(purchases.firmId, firmId), inArray(purchases.id, ids('purchase')))) : [],
    ids('invoice').length ? db().select({ i: invoices, pn: partners.name }).from(invoices).leftJoin(partners, eq(partners.id, invoices.partnerId)).where(and(eq(invoices.firmId, firmId), inArray(invoices.id, ids('invoice')))) : [],
    ids(OFFICE_FILE_ENTITY.dossier).length ? db().select().from(dossierDocs).where(and(eq(dossierDocs.firmId, firmId), inArray(dossierDocs.id, ids(OFFICE_FILE_ENTITY.dossier)))) : [],
    ids('employee').length ? db().select({ id: employees.id, no: employees.no, name: employees.name, start: employees.start }).from(employees).where(and(eq(employees.firmId, firmId), inArray(employees.id, ids('employee')))) : [],
    ids('cash_voucher').length ? db().select().from(cashVouchers).where(inArray(cashVouchers.id, ids('cash_voucher'))) : [],
    db().select({ t: journals.sourceType, s: journals.sourceId, n: journals.number }).from(journals).where(and(eq(journals.firmId, firmId), inArray(journals.sourceType, ['purchase', 'invoice', 'cash_voucher']))),
  ]);
  // bank statements keep their file in `bank_statements.file_id` (no `file_links` row): PDF / scan / XML of the import
  const [B, [fr]] = await Promise.all([
    db().select({ s: bankStatements, an: bankAccounts.name, acc: bankAccounts.account, cur: bankAccounts.cur }).from(bankStatements)
      .innerJoin(bankAccounts, eq(bankAccounts.id, bankStatements.bankAccountId))
      .where(and(eq(bankStatements.firmId, firmId), inArray(bankStatements.fileId, F.map((f) => f.id)))),
    db().select({ s: firms.settings }).from(firms).where(eq(firms.id, firmId)).limit(1),
  ]);
  const img = firmImages(fr?.s);
  const nal = new Map(J.map((j) => [`${j.t}:${j.s}`, j.n]));
  const filesOf = (t: string, id: string) => L.filter((l) => l.entityType === t && l.entityId === id).map((l) => byId.get(l.fileId)).filter((f): f is NonNullable<typeof f> => !!f)
    .map((f) => ({ id: f.id, name: f.name, mime: f.mime }));
  const R: ArchRow[] = [];
  for (const { p, pn } of P) R.push({ key: `purchase:${p.id}`, date: p.date, kind: p.cash ? 'Фискална сметка' : p.imp ? 'Увозна калкулација' : 'Влезна фактура', no: p.number || p.calcNo || '', pn: pn ?? '', amt: p.total, files: filesOf('purchase', p.id), href: `/vlez?edit=${p.id}`, nalog: nal.get(`purchase:${p.id}`) });
  for (const { i, pn } of I) R.push({ key: `invoice:${i.id}`, date: i.date, kind: i.kind === 'credit' ? 'Одобрение' : i.kind === 'proforma' ? 'Профактура' : i.kind === 'dispatch' ? 'Испратница' : 'Излезна фактура', no: i.number, pn: pn ?? '', amt: i.total, files: filesOf('invoice', i.id), href: `${INV_HREF[i.kind] ?? '/izlez'}?edit=${i.id}`, nalog: nal.get(`invoice:${i.id}`) });
  for (const d of D) R.push({ key: `dossier_doc:${d.id}`, date: d.date ?? '', kind: d.category || 'Документ', no: d.number ?? '', pn: d.partnerName ?? d.title ?? '', amt: null, files: filesOf(OFFICE_FILE_ENTITY.dossier, d.id), href: '/dosie', archId: d.id });
  for (const e of E) R.push({ key: `employee:${e.id}`, date: e.start ?? '', kind: 'Вработен', no: e.no ?? '', pn: e.name, amt: null, files: filesOf('employee', e.id), href: `/vraboteni?edit=${e.id}` });
  for (const c of C) R.push({ key: `cash_voucher:${c.id}`, date: c.date, kind: 'Фискална сметка', no: c.docNo || c.number, pn: c.merchant ?? '', amt: c.amt, files: filesOf('cash_voucher', c.id), href: '/blagajna', nalog: nal.get(`cash_voucher:${c.id}`) });
  for (const { s: b, an, acc, cur } of B) {
    const f = b.fileId ? byId.get(b.fileId) : undefined;
    if (f) R.push({ key: `bank_statement:${b.id}`, date: b.date, kind: 'Извод', no: b.number ?? '', pn: [an, acc].filter(Boolean).join(' · '), amt: null, files: [{ id: f.id, name: f.name, mime: f.mime }], href: `${cur === 'MKD' ? '/banka' : '/devizni'}?acct=${b.bankAccountId}&m=${b.date.slice(5, 7)}` });
  }
  for (const f of F) if (img.has(f.id)) R.push({ key: `firm_image:${f.id}`, date: f.at.toISOString().slice(0, 10), kind: 'Лого / потпис / печат', no: '', pn: '', amt: null, files: [{ id: f.id, name: f.name, mime: f.mime }], href: `/firmi?edit=${firmId}` });
  // files attached to nothing (or only to screens without a row) — legacy had none of those, the server shows them
  const shown = new Set(R.flatMap((r) => r.files.map((f) => f.id)));
  const linked = new Set(L.filter((l) => l.entityType !== 'firm').map((l) => l.fileId));
  for (const f of F) if (!shown.has(f.id) && !linked.has(f.id)) R.push({ key: `file:${f.id}`, date: f.at.toISOString().slice(0, 10), kind: 'Датотека', no: '', pn: '', amt: null, files: [{ id: f.id, name: f.name, mime: f.mime }], loose: true });
  return archSort(R.filter((r) => r.files.length));
}

/**
 * Why a file can't be deleted or moved from the archive (null = loose: attached to nothing). Covers `file_links`, the
 * tables that keep a `file_id` (bank statements, cash vouchers, МПИН, Word templates), AI reads already saved as a
 * document and the firm's logo / signature / stamp.
 */
export async function fileInUse(tx: Tx, f: { id: string; firmId: string | null }): Promise<string | null> {
  const one = <T>(p: Promise<T[]>) => p.then((r) => r.length > 0);
  const [link, bank, cash, ai, mi, ma, wt] = await Promise.all([
    one(tx.select({ x: fileLinks.fileId }).from(fileLinks).where(eq(fileLinks.fileId, f.id)).limit(1)),
    one(tx.select({ x: bankStatements.id }).from(bankStatements).where(eq(bankStatements.fileId, f.id)).limit(1)),
    one(tx.select({ x: cashVouchers.id }).from(cashVouchers).where(eq(cashVouchers.fileId, f.id)).limit(1)),
    one(tx.select({ x: aiDocuments.id }).from(aiDocuments).where(and(eq(aiDocuments.fileId, f.id), eq(aiDocuments.status, 'saved'))).limit(1)),
    one(tx.select({ x: mpinInbox.id }).from(mpinInbox).where(eq(mpinInbox.fileId, f.id)).limit(1)),
    one(tx.select({ x: mpinAcks.id }).from(mpinAcks).where(eq(mpinAcks.fileId, f.id)).limit(1)),
    one(tx.select({ x: wordTemplates.id }).from(wordTemplates).where(eq(wordTemplates.fileId, f.id)).limit(1)),
  ]);
  if (link || ai || cash || mi || ma || wt) return 'прикачена на документ';
  if (bank) return 'прикачена на извод';
  if (f.firmId) {
    const [fr] = await tx.select({ s: firms.settings }).from(firms).where(eq(firms.id, f.firmId)).limit(1);
    if (firmImages(fr?.s).has(f.id)) return 'лого / потпис / печат на фирмата';
  }
  return null;
}

/** AI reads of a loose file that were never saved (failed or abandoned statement / invoice reads) — they go with the file. */
export const dropUnsavedReads = (tx: Tx, fileId: string) =>
  tx.delete(aiDocuments).where(and(eq(aiDocuments.fileId, fileId), ne(aiDocuments.status, 'saved')));
