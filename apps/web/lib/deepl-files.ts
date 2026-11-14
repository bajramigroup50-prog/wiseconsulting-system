import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { can } from '@wise/core';
import { audit, fileLinks, files } from '@wise/db';
import type { SessionUser } from './auth';
import { db } from './db';
import { isDemoUser } from './demo';
import { deeplDocOk, deeplDocument, deeplErr, DEEPL_DOC_EXT, DEEPL_LANGS, translatedName, type DeeplLang } from './deepl';
import { getObjectBytes, objectKey, putObjectBytes } from './storage';

/** A translation is linked to its original file: `file_links` (translation file, 'translation', original id, role = lang). */
export const TRANSLATION_ENTITY = 'translation';

const MIME: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', htm: 'text/html', html: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const extOf = (n: string) => (/\.([a-z0-9]+)$/i.exec(n)?.[1] ?? '').toLowerCase();

/**
 * 🌐 Translate a stored file with DeepL and save the result next to it: same firm, linked to the original
 * (`translation`) and to every entity the original is attached to (a dossier document shows both files).
 */
export async function translateStoredFile(u: SessionUser, fileId: string, to: DeeplLang): Promise<{ error?: string; ok?: string; id?: string }> {
  if (isDemoUser(u)) return { error: 'Преводот со DeepL не е достапен во демото.' };
  const [f] = await db().select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f || f.status !== 'ready' || !can(u.principal, f.firmId ? 'write' : 'office', f.firmId)) return { error: 'Датотеката не постои.' };
  if (!deeplDocOk(f.name)) return { error: `DeepL преведува само ${DEEPL_DOC_EXT.join(', ').toUpperCase()} – „${f.name}“ не е таква датотека (скенирана слика прво зачувајте ја како PDF).` };
  const [prev] = await db().select({ id: fileLinks.fileId }).from(fileLinks)
    .where(and(eq(fileLinks.entityType, TRANSLATION_ENTITY), eq(fileLinks.entityId, f.id), eq(fileLinks.role, to))).limit(1);
  if (prev) return { ok: `Веќе е преведена на ${DEEPL_LANGS[to]}.`, id: prev.id };
  try {
    const src = await getObjectBytes(f.bucketKey);
    const { bytes, billed } = await deeplDocument(src, f.name, to);
    const name = translatedName(f.name, to);
    const key = objectKey(f.firmId, name);
    await putObjectBytes(key, bytes, MIME[extOf(name)] ?? f.mime);
    const links = await db().select().from(fileLinks).where(eq(fileLinks.fileId, f.id));
    const id = await db().transaction(async (tx) => {
      const [n] = await tx.insert(files).values({
        firmId: f.firmId, bucketKey: key, name, mime: MIME[extOf(name)] ?? f.mime, size: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'), status: 'ready', uploadedBy: u.id,
      }).returning({ id: files.id });
      await tx.insert(fileLinks).values([
        { fileId: n!.id, entityType: TRANSLATION_ENTITY, entityId: f.id, role: to },
        ...links.filter((l) => l.entityType !== TRANSLATION_ENTITY).map((l) => ({ fileId: n!.id, entityType: l.entityType, entityId: l.entityId, role: l.role })),
      ]).onConflictDoNothing();
      await audit(tx, { userId: u.id, firmId: f.firmId, action: 'deeplDoc', entityType: 'file', entityId: n!.id, data: { from: f.id, to, billed } });
      return n!.id;
    });
    return { ok: `✓ Преведено на ${DEEPL_LANGS[to]}: „${name}“ (зачувано до оригиналот${billed ? `, ${billed.toLocaleString('mk-MK')} знаци` : ''}).`, id };
  } catch (e) {
    return { error: deeplErr(e) };
  }
}

/** Translations of the given files: original id → [{ id, name, lang }]. */
export async function translationsOf(ids: string[]): Promise<Map<string, { id: string; name: string; lang: string }[]>> {
  const M = new Map<string, { id: string; name: string; lang: string }[]>();
  if (!ids.length) return M;
  const rows = await db().select({ o: fileLinks.entityId, lang: fileLinks.role, id: files.id, name: files.name }).from(fileLinks)
    .innerJoin(files, eq(files.id, fileLinks.fileId))
    .where(and(eq(fileLinks.entityType, TRANSLATION_ENTITY), inArray(fileLinks.entityId, ids)));
  for (const r of rows) M.set(r.o, [...(M.get(r.o) ?? []), { id: r.id, name: r.name, lang: r.lang }]);
  return M;
}

/** Files that are themselves translations (so the 🌐 button is not offered on them). */
export async function translationFileIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db().select({ id: fileLinks.fileId }).from(fileLinks)
    .where(and(eq(fileLinks.entityType, TRANSLATION_ENTITY), inArray(fileLinks.fileId, ids)));
  return new Set(rows.map((r) => r.id));
}
