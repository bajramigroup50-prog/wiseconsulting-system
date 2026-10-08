import { eq } from 'drizzle-orm';
import { audit, files, wordTemplates } from '@wise/db';
import { TPL_COMMON } from '@wise/core/office';
import { Forbidden, getUser, requireCan } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { fillDocx, minimalDocx } from '@/lib/docx';
import { firmTemplateVars, isUuid } from '@/lib/office';
import { getObjectBytes } from '@/lib/storage';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const attachment = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

/**
 * Legacy `tplUse` / `tplRun`: fill a Word template with the current firm's data and download it.
 * `/api/office/tpl/sample` returns a sample template listing every common placeholder.
 * Extra values can be passed as query parameters (`?ДОГОВОР_БРОЈ=…`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u0 = await getUser();
  if (!u0) return new Response('unauthorized', { status: 401 });
  if (id === 'sample') {
    const doc = minimalDocx([['ПРИМЕР ШАБЛОН'], ...TPL_COMMON.map((k) => [`${k}: {{${k}}}`])]);
    return new Response(Buffer.from(doc), { headers: { 'content-type': DOCX, 'content-disposition': attachment('primer-shablon.docx') } });
  }
  const firm = await currentFirm(u0);
  if (!firm || !isUuid(id)) return new Response('not found', { status: 404 });
  try {
    const u = await requireCan('office', firm.id);
    const [t] = await db().select({ t: wordTemplates, key: files.bucketKey }).from(wordTemplates).innerJoin(files, eq(files.id, wordTemplates.fileId)).where(eq(wordTemplates.id, id)).limit(1);
    if (!t) return new Response('not found', { status: 404 });
    const extra = Object.fromEntries([...new URL(req.url).searchParams].map(([k, v]) => [k, v.slice(0, 500)]));
    const { out, missing } = fillDocx(await getObjectBytes(t.key), await firmTemplateVars(firm, extra));
    await db().transaction((tx) => audit(tx, { userId: u.id, firmId: firm.id, action: 'tplUse', entityType: 'word_template', entityId: id, data: { name: t.t.name, missing } }));
    return new Response(Buffer.from(out), { headers: { 'content-type': DOCX, 'content-disposition': attachment(`${t.t.name} – ${firm.name}.docx`) } });
  } catch (e) {
    if (e instanceof Forbidden) return new Response(e.message, { status: 403 });
    throw e;
  }
}
