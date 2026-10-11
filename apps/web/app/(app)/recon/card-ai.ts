'use client';
/** Legacy `recParse` 12923: PDF / image partner cards are read by AI (kind `rec`) before the comparison runs. */
import { uploadFile } from '@/lib/upload';
import { aiReadStatus, startAiRead } from '@/app/(app)/_ai/actions';

const isAi = (f: File) => /\.(pdf|jpe?g|png|webp)$/i.test(f.name) || /^image\/|pdf/.test(f.type);

/** For every PDF / image file field: upload, read, and replace it by `<name>Ai` = the read id. Returns an error or ''. */
export async function readCardsAi(fd: FormData, names: string[], firmId: string, note: (m: string) => void): Promise<string> {
  for (const n of names) {
    const f = fd.get(n);
    if (!(f instanceof File) || !f.size || !isAi(f)) continue;
    note(`Се прикачува „${f.name}“…`);
    const up = await uploadFile(f, firmId);
    if (!up.ok) return `„${f.name}“: ${up.error}`;
    const s = await startAiRead({ kind: 'rec', fileIds: [up.id] });
    if (!s.ids?.[0]) return s.error ?? 'Картицата не е прочитана.';
    note(`Се чита картицата „${f.name}“… (10–60 секунди)`);
    let ok = false;
    for (let t = 0; t < 120 && !ok; t++) {
      await new Promise((r) => setTimeout(r, 2500));
      const [x] = await aiReadStatus([s.ids[0]]);
      if (x?.status === 'error') return 'Картицата не е прочитана: ' + (x.error ?? '');
      ok = x?.status === 'done' || x?.status === 'saved';
    }
    if (!ok) return 'Читањето трае предолго – обидете се повторно.';
    fd.set(n + 'Ai', s.ids[0]);
    fd.set(n, new File([], f.name));
  }
  note('');
  return '';
}
