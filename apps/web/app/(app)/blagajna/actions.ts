'use server';
/** Legacy ACT `blgReg … blgXlsx` (7937–7952) and `blgSetSave`: cash registers and vouchers, posted via `blgEntries`. */
import { redirect } from 'next/navigation';
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
