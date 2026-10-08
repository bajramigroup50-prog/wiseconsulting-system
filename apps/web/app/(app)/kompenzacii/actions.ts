'use server';
/** Legacy ACT `kompSave` / `kompDel` (8964–8970). */
import { redirect } from 'next/navigation';
import { deleteCompensation, saveCompensation } from '@wise/db';
import { bankRun, isDate, num, str } from '@/lib/bank';
import type { FormState } from '@/components/bank-form';

const P = ['/kompenzacii', '/nalozi'];

export async function saveKompAction(_p: FormState, form: FormData): Promise<FormState> {
  const date = str(form.get('date'));
  if (!isDate(date)) return { error: 'Внесете датум.' };
  const amounts: Record<string, number> = {};
  for (const [k, v] of form.entries()) if (k.startsWith('amt:')) { const n = num(v); if (n) amounts[k.slice(4)] = n; }
  let id = '';
  const r = await bankRun('kompSave', P, async ({ tx, u, firm, year }) => {
    const x = await saveCompensation(tx, {
      firmId: firm.id, userId: u.id,
      input: {
        id: str(form.get('id')) || null, kind: str(form.get('kind')) === 'multi' ? 'multi' : 'bi', date, number: str(form.get('number')) || null,
        note: str(form.get('note')) || null, year, amounts, partnerIds: form.getAll('p').map(String),
      },
    });
    id = x.id;
    return `Компензацијата ${x.number} е книжена (налог ${x.nalog}).`;
  });
  if (r.error) return r;
  redirect(`/kompenzacii?saved=${id}`);
}

export async function deleteKompAction(id: string): Promise<FormState> {
  return bankRun('kompDel', P, ({ tx, u, firm }) => deleteCompensation(tx, { firmId: firm.id, userId: u.id, id }).then(() => 'Избришано.'));
}
