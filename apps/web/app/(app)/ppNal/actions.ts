'use server';
/** Legacy ACT `ppSave` / `ppDel` / `ppPr…` (15824–15833): payment orders ПП30 / ПП50 / ПП10. */
import { redirect } from 'next/navigation';
import type { PaymentOrder, PpKind } from '@wise/core';
import { deletePaymentOrder, markOrdersPrinted, savePaymentOrder } from '@wise/db';
import { bankRun, num, str } from '@/lib/bank';
import type { FormState } from '@/components/action-form';

const FIELDS = ['date', 'valDate', 'nacin', 'code', 'payer', 'payerAcc', 'payerBank', 'payerTax', 'recip', 'recipAcc', 'recipBank', 'purpose',
  'refDebit', 'refCredit', 'uplSm', 'prihod', 'place', 'taxKey'] as const;

export async function savePpAction(_p: FormState, form: FormData): Promise<FormState> {
  const kind = str(form.get('kind')) as PpKind;
  const order = { kind, amount: num(form.get('amount')), iban: form.get('iban') === 'on' } as PaymentOrder;
  for (const k of FIELDS) (order as unknown as Record<string, string>)[k] = String(form.get(k) ?? '').trim();
  let id = str(form.get('id')) || null;
  const r = await bankRun('ppSave', ['/ppNal'], async ({ tx, u, firm }) => {
    id = await savePaymentOrder(tx, { firmId: firm.id, userId: u.id, id, order, refId: str(form.get('refId')) || null });
    return 'Налогот е зачуван.';
  });
  if (r.error) return r;
  redirect(`/ppNal?edit=${id}`);
}

export async function deletePpAction(id: string): Promise<FormState> {
  return bankRun('ppDel', ['/ppNal'], ({ tx, u, firm }) => deletePaymentOrder(tx, { firmId: firm.id, userId: u.id, id }).then(() => 'Избришано.'));
}

export async function markPrintedAction(ids: string[]): Promise<FormState> {
  return bankRun('ppSave', ['/ppNal'], ({ tx, u, firm }) => markOrdersPrinted(tx, { firmId: firm.id, userId: u.id, ids }).then(() => 'Испечатено.'));
}
