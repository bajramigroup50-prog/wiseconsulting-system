'use server';
/**
 * „🔄 Конвертор на датотеки“: PDF text → grid (server side, pdfjs) and the office-wide mapping presets
 * (`app_settings.convPresets`). Excel / CSV / XML are read in the browser; the conversion and the check with the
 * importers' own parsers are pure (`@wise/core/convert`).
 */
import { revalidatePath } from 'next/cache';
import { convPresetClean, type ConvPreset } from '@wise/core/convert/index';
import { pdfAutoGrid, pdfLines } from '@wise/core/noai/pdf-lines';
import { finNalogFromLines, finNalogGrid } from '@wise/core/noai/fin-nalog';
import { bankPdfGrid } from '@wise/core/noai/bank-grid';
import { audit, getConvPresets, putConvPresets } from '@wise/db';
import { Forbidden, requireUser } from '@/lib/auth';
import { actionError } from '@/lib/books';
import { db } from '@/lib/db';
import { pdfTextItems } from '@/lib/pdf-text';

const office = async () => {
  const u = await requireUser();
  if (u.role === 'klient' || u.role === 'teren') throw new Forbidden('konvertor');
  return u;
};

/**
 * A PDF with a text layer as rows of cells; scanned PDFs have no text. `bank`: the same PDF cut into the columns of
 * its bank-statement table (header over several lines, values printed close together kept apart), when it has one.
 */
export async function readPdfGrid(form: FormData): Promise<{ grid?: string[][]; bank?: string[][]; error?: string }> {
  try {
    await office();
    const f = form.get('file');
    if (!(f instanceof File)) return { error: 'Изберете датотека.' };
    if (f.size > 20 * 1024 * 1024) return { error: 'Датотеката е преголема (најмногу 20 MB).' };
    const items = await pdfTextItems(new Uint8Array(await f.arrayBuffer()));
    const L = pdfLines(items);
    if (!L.length) return { error: 'PDF-от нема текст (скениран документ / слика) – без AI не може да се прочита. Побарајте Excel/CSV/XML од програмата или банката.' };
    // the old program's „Финансов налог“ (e.g. the opening journal): one clean row per record, opening-balance headings
    const F = finNalogFromLines(L);
    if (F) return { grid: finNalogGrid(F) };
    const B = bankPdfGrid(items);
    return { grid: pdfAutoGrid(L), ...(B ? { bank: B.grid } : {}) };
  } catch (e) {
    const r = actionError(e);
    return { error: r.error ?? 'PDF-от не може да се отвори.' };
  }
}

export async function listConvPresets(): Promise<ConvPreset[]> {
  await office();
  return getConvPresets(db());
}

/** Save (insert or replace by id / by name + target) a mapping preset. */
export async function saveConvPreset(p: unknown): Promise<{ error?: string; presets?: ConvPreset[]; id?: string }> {
  try {
    const u = await office();
    const c = convPresetClean(p);
    if (!c) return { error: 'Внесете назив на шаблонот и изберете цел.' };
    const P = await db().transaction(async (tx) => {
      const cur = await getConvPresets(tx);
      const i = cur.findIndex((x) => x.id === c.id || (x.name.toLowerCase() === c.name.toLowerCase() && x.target === c.target));
      const next = i >= 0 ? cur.map((x, k) => (k === i ? { ...c, id: x.id } : x)) : [c, ...cur];
      await putConvPresets(tx, next, u.id);
      await audit(tx, { userId: u.id, firmId: null, action: 'convPreset', entityType: 'app_settings', data: { name: c.name, target: c.target } });
      return next;
    });
    revalidatePath('/konvertor');
    return { presets: P, id: P.find((x) => x.name === c.name && x.target === c.target)?.id };
  } catch (e) { return { error: actionError(e).error }; }
}

export async function deleteConvPreset(id: string): Promise<{ error?: string; presets?: ConvPreset[] }> {
  try {
    const u = await office();
    const P = await db().transaction(async (tx) => {
      const next = (await getConvPresets(tx)).filter((x) => x.id !== id);
      await putConvPresets(tx, next, u.id);
      return next;
    });
    revalidatePath('/konvertor');
    return { presets: P };
  } catch (e) { return { error: actionError(e).error }; }
}
