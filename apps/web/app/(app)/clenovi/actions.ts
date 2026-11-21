'use server';
/** „🧑‍🤝‍🧑 Регистар на членови“: save / delete a member, the Excel import and „регистарот е ажуриран“. */
import * as XLSX from 'xlsx';
import { parseMembers } from '@wise/core/npo';
import { deleteMember, importMembers, markMembersReviewed, saveMember } from '@wise/db';
import { indRun, str, today } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/clenovi', '/rokovi'];

export async function saveMemberAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('npoMemSave', P, async ({ tx, a }) => {
    await saveMember(tx, a, {
      id: str(f.get('id')) || null, name: str(f.get('name')), embg: str(f.get('embg')), address: str(f.get('address')), phone: str(f.get('phone')),
      email: str(f.get('email')), joined: str(f.get('joined')) || null, left: str(f.get('left')) || null, organ: str(f.get('organ')), role: str(f.get('role')), note: str(f.get('note')),
    });
    return 'Членот е зачуван.';
  });
}

export async function deleteMemberAction(id: string): Promise<FormState> {
  return indRun('npoMemDel', P, async ({ tx, a }) => { await deleteMember(tx, a, id); return 'Членот е избришан.'; });
}

export async function reviewMembersAction(_p: FormState, _f: FormData): Promise<FormState> {
  return indRun('npoMemReview', P, async ({ tx, a }) => { await markMembersReviewed(tx, a, today()); return 'Регистарот е означен како прегледан и ажуриран денес.'; });
}

export async function importMembersAction(_p: FormState, f: FormData): Promise<FormState> {
  const file = f.get('file');
  if (!(file instanceof File) || !file.size) return { error: 'Изберете Excel датотека (.xlsx).' };
  if (file.size > 5_000_000) return { error: 'Датотеката е преголема (најмногу 5 MB).' };
  let parsed: ReturnType<typeof parseMembers> = { list: [], skipped: 0 };
  try {
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    for (const n of wb.SheetNames) {
      const r = parseMembers(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n]!, { header: 1, raw: true, defval: '' }));
      if (r.list.length) { parsed = r; break; }
    }
  } catch { return { error: 'Датотеката не може да се прочита. Зачувајте ја како .xlsx и обидете се повторно.' }; }
  if (!parsed.list.length) return { error: 'Не е најдена колона „Име и презиме“.' };
  return indRun('npoMemImport', P, async ({ tx, a }) => {
    const r = await importMembers(tx, a, parsed.list);
    return `Увезено: ${r.added} нови, ${r.updated} ажурирани${parsed.skipped ? `, ${parsed.skipped} редови без име прескокнати` : ''}.`;
  });
}
