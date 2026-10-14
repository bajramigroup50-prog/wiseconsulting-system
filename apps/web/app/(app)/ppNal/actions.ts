'use server';
/** Legacy ACT `ppSave` / `ppDel` / `ppPr…` (15824–15833): payment orders ПП30 / ПП50 / ПП10. */
import { redirect } from 'next/navigation';
import type { PaymentOrder, PpKind } from '@wise/core';
import { ppCalValue } from '@wise/core/bank/fin-parity';
import { createSupplierPaymentOrders, deletePaymentOrder, markOrdersPrinted, savePaymentOrder, savePpCalibration } from '@wise/db';
import { bankRun, isDate, num, str } from '@/lib/bank';
import { todayIso } from '@/lib/fmt';
import type { FormState } from '@/components/bank-form';

const FIELDS = ['date', 'valDate', 'nacin', 'code', 'payer', 'payerAcc', 'payerBank', 'payerTax', 'recip', 'recipAcc', 'recipBank', 'purpose',
  'refDebit', 'refCredit', 'uplSm', 'prihod', 'place', 'taxKey'] as const;

export async function savePpAction(_p: FormState, form: FormData): Promise<FormState> {
  const kind = str(form.get('kind')) as PpKind;
  const order = { kind, amount: num(form.get('amount')), iban: form.get('iban') === 'on' } as PaymentOrder;
  for (const k of FIELDS) (order as unknown as Record<string, string>)[k] = String(form.get(k) ?? '').trim();
  const refIds = str(form.get('refIds')).split(',').map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
  if (refIds.length) order.refIds = refIds;
  let id = str(form.get('id')) || null;
  const r = await bankRun('ppSave', ['/ppNal'], async ({ tx, u, firm }) => {
    id = await savePaymentOrder(tx, { firmId: firm.id, userId: u.id, id, order, refId: refIds[0] ?? (str(form.get('refId')) || null) });
    return 'Налогот е зачуван.';
  });
  if (r.error) return r;
  redirect(`/ppNal?edit=${id}`);
}

export async function deletePpAction(id: string): Promise<FormState> {
  return bankRun('ppDel', ['/ppNal'], ({ tx, u, firm }) => deletePaymentOrder(tx, { firmId: firm.id, userId: u.id, id }).then(() => 'Избришано.'));
}

/** Calibration for pre-printed forms (legacy `data-ppcal` listener 15823) → office setting `ppCal[kind]`. */
export async function savePpCalAction(kind: PpKind, _p: FormState, form: FormData): Promise<FormState> {
  return bankRun('ppSave', ['/ppNal'], ({ tx, u, firm }) => savePpCalibration(tx, {
    userId: u.id, firmId: firm.id, kind, dx: ppCalValue(form.get('dx')), dy: ppCalValue(form.get('dy')),
  }).then(() => 'Калибрацијата е зачувана.'));
}

export async function markPrintedAction(ids: string[]): Promise<FormState> {
  return bankRun('ppSave', ['/ppNal'], ({ tx, u, firm }) => markOrdersPrinted(tx, { firmId: firm.id, userId: u.id, ids }).then(() => 'Испечатено.'));
}

/**
 * „Подготви ПП30 за избраните“: one ПП30 per supplier for the ticked unpaid purchase invoices, then back to the list
 * with a link that prints them all on one PDF (3 per A4 page).
 */
export async function batchPpAction(_p: FormState, form: FormData): Promise<FormState> {
  const refIds = form.getAll('pick').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  const d = str(form.get('date'));
  const date = isDate(d) ? d : todayIso();
  let made: { ids: string[]; missing: string[] } = { ids: [], missing: [] };
  const r = await bankRun('ppSave', ['/ppNal'], async ({ tx, u, firm, year }) => {
    made = await createSupplierPaymentOrders(tx, { firmId: firm.id, userId: u.id, year, refIds, date });
    return 'Подготвени налози: ' + made.ids.length;
  });
  if (r.error) return r;
  const q = new URLSearchParams({ made: made.ids.join(',') });
  if (made.missing.length) q.set('miss', made.missing.join(' · ').slice(0, 600));
  redirect('/ppNal?' + q.toString());
}
