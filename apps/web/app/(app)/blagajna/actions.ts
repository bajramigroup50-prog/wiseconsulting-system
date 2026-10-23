'use server';
/** Legacy ACT `blgReg … blgXlsx` (7937–7952) and `blgSetSave`: cash registers and vouchers, posted via `blgEntries`. */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { aiDocuments, draftSourceFiles, journals, refreshStaleScanDrafts, releaseDeletedScanDrafts, saveSelectedScanDrafts } from '@wise/db';
import { deletePurchasesAction } from '../vlez/actions';
import { periodOf } from '@wise/core';
import { actorOf } from '@/lib/sales';
import { db } from '@/lib/db';
import { actionError, firmAction } from '@/lib/books';
import { arFileDel } from '../arhiva/actions';
import { createDefaultRegisters, deleteVoucher, loadRegisters, removeRegister, saveRegister, saveVoucher } from '@wise/db';
import { markAiReadsSaved } from '@/lib/ai';
import { bankRun, isDate, num, str } from '@/lib/bank';
import type { FormState } from '@/components/bank-form';

const P = ['/blagajna', '/nalozi', '/kkart'];

export async function createDefaultRegistersAction(): Promise<FormState> {
  return bankRun('blgSetSave', P, async ({ tx, u, firm }) => `Креирани ${await createDefaultRegisters(tx, { firmId: firm.id, userId: u.id })} благајни.`);
}

export async function saveRegisterAction(_p: FormState, form: FormData): Promise<FormState> {
  return bankRun('blgSetSave', P, ({ tx, u, firm }) => saveRegister(tx, {
    firmId: firm.id, userId: u.id,
    input: { id: str(form.get('id')) || null, name: str(form.get('name')), konto: str(form.get('konto')).split(/\s/)[0]!, cur: str(form.get('cur')) || 'MKD' },
  }).then(() => 'Благајната е зачувана.'));
}

export async function removeRegisterAction(id: string): Promise<FormState> {
  return bankRun('blgSetRm', P, ({ tx, u, firm }) => removeRegister(tx, { firmId: firm.id, userId: u.id, id }).then(() => 'Отстрането.'));
}

export async function saveVoucherAction(_p: FormState, form: FormData): Promise<FormState> {
  const date = str(form.get('date'));
  if (!isDate(date)) return { error: 'Внесете датум.' };
  const kind = str(form.get('kind')) === 'in' ? 'in' : 'out';
  let saved: { id: string; number: string; nalog: string; duplicate?: string; reg: string } | null = null;
  const r = await bankRun('blgSave', P, async ({ tx, u, firm }) => {
    const x = await saveVoucher(tx, {
      firmId: firm.id, userId: u.id,
      input: {
        id: str(form.get('id')) || null, registerId: str(form.get('reg')), kind, date, number: str(form.get('number')) || null,
        docNo: str(form.get('docNo')) || null, merchant: str(form.get('merchant')) || null, vatId: str(form.get('vatId')) || null,
        country: str(form.get('country')) || 'MK', cur: str(form.get('cur')) || 'MKD', amt: num(form.get('amt')) ?? 0, fx: num(form.get('fx')),
        vatRate: num(form.get('rate')), vat: num(form.get('vat')), cat: str(form.get('cat')) || null, konto: str(form.get('konto')).split(/\s/)[0] || null,
        partnerId: str(form.get('partner')) || null, note: str(form.get('note')) || null, payK: str(form.get('payK')) || null,
        liters: num(form.get('liters')), fileId: str(form.get('fileId')) || null,
      },
    });
    saved = { ...x, reg: str(form.get('reg')) };
    return `${kind === 'in' ? 'Уплатница' : 'Исплатница'} ${x.number} е зачувана (налог ${x.nalog}).${x.duplicate ? ` Внимание: веќе постои ${x.duplicate} со ист број, датум и износ.` : ''}`;
  });
  if (r.error || !saved) return r;
  const s = saved as { duplicate?: string; reg: string };
  if (s.duplicate) return r;
  redirect(`/blagajna?reg=${s.reg}`);
}

export async function deleteVoucherAction(id: string): Promise<FormState> {
  return bankRun('del', P, ({ tx, u, firm }) => deleteVoucher(tx, { firmId: firm.id, userId: u.id, id }).then(() => 'Избришано.'));
}

/** One reviewed receipt of the bulk scan (`ReceiptDraft` of `@wise/core/ai/receipts` + its file). */
export interface ScannedReceipt {
  date: string; country: string; cur: string; docNo: string; merchant: string; vatId: string; amt: number | ''; fx: number | '';
  rate: number; vat: number | ''; cat: string; konto: string; liters: number | ''; fileId: string | null;
}

/**
 * Legacy ACT `blgBSave` (7945): save and post the reviewed receipts as исплатници of one register, in date order,
 * numbered automatically; marks the AI reads as used. One transaction: a receipt that cannot be saved stops all.
 */
export async function saveReceiptBatchAction(reg: string, rows: ScannedReceipt[], docIds: string[]): Promise<FormState> {
  if (!Array.isArray(rows) || !rows.length) return { error: 'Нема сметки за зачувување.' };
  if (rows.length > 500) return { error: 'Премногу сметки одеднаш.' };
  const n = (v: unknown) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return bankRun('blgSave', P, async ({ tx, u, firm }) => {
    const L = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let dup = 0;
    for (const [i, x] of L.entries()) {
      try {
        const s = await saveVoucher(tx, {
          firmId: firm.id, userId: u.id,
          input: {
            id: null, registerId: String(reg), kind: 'out', date: String(x.date), number: null, docNo: String(x.docNo || '') || null,
            merchant: String(x.merchant || '') || null, vatId: String(x.vatId || '') || null, country: String(x.country || 'MK'), cur: String(x.cur || 'MKD'),
            amt: n(x.amt) ?? 0, fx: n(x.fx), vatRate: n(x.rate), vat: n(x.vat), cat: String(x.cat || '') || null, konto: String(x.konto || '').split(/\s/)[0] || null,
            partnerId: null, note: null, payK: null, liters: n(x.liters), fileId: typeof x.fileId === 'string' && x.fileId ? x.fileId : null,
          },
        });
        if (s.duplicate) dup++;
      } catch (e) {
        if (e instanceof Error) e.message = `Сметка ${i + 1} (${x.docNo || x.merchant || x.date}): ${e.message}`;
        throw e;
      }
    }
    await markAiReadsSaved(tx, firm.id, Array.isArray(docIds) ? docIds.map(String) : []);
    const name = (await loadRegisters(tx, firm.id)).find((x) => x.id === reg)?.name ?? '';
    return `${L.length} сметки се зачувани и прокнижени во ${name}.${dup ? ` Внимание: ${dup} веќе постоеја со ист број, датум и износ.` : ''}`;
  });
}

/** The cash register's nalog the receipts go into: the latest „1020/…“ nalog of the year (e.g. 1020/7-9) and its period start. */
export async function cashNalogOf(firmId: string, year: number): Promise<{ nalogNo: string; from: string | null }> {
  const [j] = await db().select({ n: journals.number, from: journals.periodFrom, d: journals.date }).from(journals)
    .where(and(eq(journals.firmId, firmId), like(journals.number, '1020/%'), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`))
    .orderBy(desc(journals.date)).limit(1);
  return { nalogNo: j?.n ?? '', from: j?.from ? String(j.from) : null };
}

/**
 * „✓ Книжи“ in „📷 Сметки платени во готово“: the receipts (`docId:index`) are booked into the cash register's nalog
 * (1020/7-9…); one dated in a closed (filed) VAT period gets the first day of that nalog's period as its booking date –
 * never a late entry into a filed ДДВ-04 – its own date kept as the document date.
 */
export async function bookCashScansAction(ids: string[]): Promise<{ ok?: string; error?: string }> {
  try {
    if (!ids.length) return { error: 'Изберете сметки.' };
    const { u, firm, year } = await firmAction('savePur');
    const nal = await cashNalogOf(firm.id, year);
    const closed = new Set(firm.vatRegistered ? (await db().select({ d: journals.date }).from(journals).where(and(eq(journals.firmId, firm.id), eq(journals.kind, 'ddv')))).map((j) => periodOf(String(j.d), firm.vatPeriod)) : []);
    const r = await db().transaction((tx) => saveSelectedScanDrafts(tx, { firmId: firm.id, kind: 'purchase', ids, actor: actorOf(u), cash: { ...nal, closed, vatKind: firm.vatPeriod } }));
    for (const p of ['/blagajna', '/vlez', '/nalozi', '/ddv', '/arhiva']) revalidatePath(p);
    const bad = r.failed.length ? ` Не се прокнижени ${r.failed.length}: ${r.failed.slice(0, 6).map((f) => `${f.number} (${f.why})`).join('; ')}${r.failed.length > 6 ? '…' : ''}` : '';
    const msg = `Прокнижени ${r.saved} сметки${nal.nalogNo ? ` во налог ${nal.nalogNo}` : ''}.${bad}`;
    return r.saved || !r.failed.length ? { ok: msg } : { error: msg };
  } catch (e) { return actionError(e); }
}

/**
 * „↺ Избриши ги прокнижените и книжи пак“: the receipts already booked from scans are deleted (the purchases and their
 * postings) and their reads become unbooked again – rebuilt with the current rules (cash, 1020/7-9, the date of a closed
 * VAT period) and back in the table, ready to book again. No new reading.
 */
export async function restartCashScansAction(purchaseIds: string[], docIds: string[]): Promise<{ ok?: string; error?: string }> {
  try {
    const { u, firm } = await firmAction('del');
    const r = await deletePurchasesAction(purchaseIds);
    await releaseDeletedScanDrafts(db(), firm.id, ['purchase']);
    const D = docIds.length ? await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), inArray(aiDocuments.id, docIds))) : [];
    if (D.length) await refreshStaleScanDrafts(db(), firm, D, { force: true, userId: u.id });
    revalidatePath('/blagajna');
    return r.error ? { error: r.error } : { ok: `${r.ok ?? ''} Сметките се повторно во табелата – „✓ Книжи ги сите спремни“.` };
  } catch (e) { return actionError(e); }
}

/** „🗑 Избриши ги избраните“: the ticked receipts (`docId:index`) are deleted with their files (never a booked one). */
export async function deleteCashScansAction(ids: string[]): Promise<{ ok?: string; error?: string }> {
  try {
    const { firm } = await firmAction('del');
    const docIds = [...new Set(ids.map((x) => String(x).split(':')[0]!).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
    if (!docIds.length) return { error: 'Изберете сметки.' };
    const D = await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), inArray(aiDocuments.id, docIds)));
    const fileIds = [...new Set(D.flatMap((d) => { const ix = ids.filter((x) => x.startsWith(d.id + ':')).map((x) => Number(x.split(':')[1])); return ix.flatMap((i) => draftSourceFiles(d, i).fileIds.length ? draftSourceFiles(d, i).fileIds : d.fileId ? [d.fileId] : []); }))];
    const r = await arFileDel(fileIds);
    revalidatePath('/blagajna');
    return r;
  } catch (e) { return actionError(e); }
}
