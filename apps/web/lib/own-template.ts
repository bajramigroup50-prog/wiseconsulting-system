import 'server-only';
/**
 * Own Word templates in the program's documents (legacy `tplActive` / `tplRun`): when the office uploaded an active
 * .docx for a document („📄 Шаблони“), Word and PDF of that document come from it instead of the built-in one.
 */
import { and, eq, inArray } from 'drizzle-orm';
import PizZip from 'pizzip';
import { docxToHtml, hrDocTplKeys, tplPick } from '@wise/core/office';
import { files, wordTemplates, type Firm } from '@wise/db';
import { db } from './db';
import { fillDocx } from './docx';
import { firmTemplateVars } from './office';
import { getObjectBytes } from './storage';

export interface OwnTpl { id: string; kind: string; name: string; version: number; key: string }

/** Active own templates for these keys (one per kind). */
export async function ownTemplates(keys: readonly string[]): Promise<OwnTpl[]> {
  if (!keys.length) return [];
  return db().select({ id: wordTemplates.id, kind: wordTemplates.kind, name: wordTemplates.name, version: wordTemplates.version, key: files.bucketKey })
    .from(wordTemplates).innerJoin(files, eq(files.id, wordTemplates.fileId))
    .where(and(inArray(wordTemplates.kind, [...new Set(keys)]), eq(wordTemplates.active, true)));
}

/** Legacy `tplActive(keys)`: the template for the first key that has one. */
export async function ownTemplate(keys: readonly string[]): Promise<OwnTpl | null> {
  return tplPick(keys, (await ownTemplates(keys)).map((t) => ({ ...t, active: true })));
}

/** Set of document keys that currently have an active own template (for showing the „📝 Word (шаблон)“ buttons). */
export async function ownTemplateKinds(keys: readonly string[]): Promise<Set<string>> {
  return new Set((await ownTemplates(keys)).map((t) => t.kind));
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' };

/** The filled .docx as HTML (legacy `tplHtml`), for the print / PDF view. */
export function docxHtml(buf: Uint8Array): string {
  const z = new PizZip(buf);
  const txt = (n: string) => z.file(n)?.asText();
  const headers: Record<string, string> = {}, media: Record<string, string> = {};
  for (const n of Object.keys(z.files)) {
    if (/^word\/header\d*\.xml$/.test(n)) headers[n] = txt(n)!;
    const ext = /^word\/media\/.+\.(\w+)$/.exec(n)?.[1]?.toLowerCase();
    if (ext && MIME[ext]) media[n] = `data:${MIME[ext]};base64,${Buffer.from(z.file(n)!.asUint8Array()).toString('base64')}`;
  }
  return docxToHtml({ document: txt('word/document.xml') ?? '', rels: txt('word/_rels/document.xml.rels'), numbering: txt('word/numbering.xml'), styles: txt('word/styles.xml'), headers, media });
}

/** Legacy `tplRun`: fill the template with the firm data + document values; Word bytes, HTML and the empty fields. */
export async function fillOwnTemplate(t: OwnTpl, firm: Firm, extra: Record<string, string | number | null | undefined>) {
  const { out, missing } = fillDocx(await getObjectBytes(t.key), await firmTemplateVars(firm, extra));
  return { docx: out, missing, html: () => docxHtml(out) };
}

/** Registered HR documents whose Word comes from an own template (legacy `tplInject` „📝 Word (шаблон)“ next to the PDF). */
export async function hrOwnDocIds(docs: readonly { id: string; kind: string; title: string | null }[]): Promise<Set<string>> {
  const keyOf = (d: { kind: string; title: string | null }) => hrDocTplKeys(d.kind, d.title);
  const kinds = await ownTemplateKinds(docs.flatMap(keyOf));
  return new Set(docs.filter((d) => keyOf(d).some((k) => kinds.has(k))).map((d) => d.id));
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const attachmentName = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
