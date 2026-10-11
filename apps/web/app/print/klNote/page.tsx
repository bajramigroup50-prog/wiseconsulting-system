/** Legacy `klNotePdf` → `klNoteHTML` (9104–9124): the store-door notice „Побарај фискална сметка“, A4. */
import { eq } from 'drizzle-orm';
import { klInspDefault, klNoteHtml } from '@wise/core/firms/klnote';
import type { KlConfig } from '@wise/core/office';
import { appSettings } from '@wise/db';
import { db } from '@/lib/db';
import { printGuard } from '../guard';

export const metadata = { title: 'Известување за продавницата' };

export default async function PrintKlNote() {
  const { firm } = await printGuard('klPortal');
  const kl = (firm.settings as { kl?: KlConfig }).kl ?? {};
  const s = firm.settings as { signer?: string };
  const [img] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'notice')).limit(1);
  const id = (img?.value as { fileId?: string } | undefined)?.fileId;
  const N = kl.note ?? {};
  const html = klNoteHtml({ ...N, insp: N.insp ?? klInspDefault(kl.prof ?? []), obj: N.obj || firm.address || '', ujp2: N.ujp2 || '198', img: id ? `/api/files/${id}` : null },
    { name: firm.name, address: firm.address, city: firm.city, edb: firm.edb, embs: firm.embs, activity: firm.activity, signer: s.signer ?? null, phone: firm.phone });
  return <div className="pdfdoc" dangerouslySetInnerHTML={{ __html: html }} />;
}
