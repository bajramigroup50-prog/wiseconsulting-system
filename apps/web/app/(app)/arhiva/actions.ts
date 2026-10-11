'use server';
import { revalidatePath } from 'next/cache';
import { deleteDossierDoc } from '../dosie/actions';

/** Legacy `arDel`: remove an archived (dossier) document from the archive. */
export async function arDel(id: string) {
  const r = await deleteDossierDoc(id);
  revalidatePath('/arhiva');
  return r;
}
