/**
 * Inspection acts (kind `kontrola`) without AI: .txt / .docx are read by the free reader even when AI works, a scan
 * with the AI credit exhausted / AI off fails with the clear „скенирана слика – потребно е AI или рачен внес“ message.
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import type Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { KontrolaFreeResult } from '@wise/core/noai/kontrola';
import { schema, setAiEnabled, type Tx } from '@wise/db';
import { setAiClient, type MessagesApi } from './client';
import { setObjectReader } from './storage';
import { docxText } from './docx-text';
import { runReadDocument } from '../jobs/ai-read-document';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '';
const bytes = new Map<string, Uint8Array>();

const CREDIT = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
const counting = (fail?: string): MessagesApi & { n: number } => {
  const api = {
    n: 0,
    async create(): Promise<Anthropic.Message> { api.n++; if (fail) throw Object.assign(new Error(fail), { status: 400 }); throw new Error('AI must not be called'); },
  };
  return api;
};

const TXT = `УПРАВА ЗА ЈАВНИ ПРИХОДИ
Бр. 13-2451/4
Скопје, 14.03.2026 година

ЗАПИСНИК
за извршена даночна контрола за периодот од 01.01.2025 до 31.12.2025

1. Утврдено е дека на издадените фактури во износ од 500.000,00 денари не е пресметан ДДВ во износ од 90.000,00 денари, спротивно на член 53 став 8 од Законот за ДДВ.

2. Констатирано е дека е помалку платен ДДВ од 21.600,00 ден. спротивно на член 34 од Законот за ДДВ.

Правна поука: Обврзникот има право во рок од 8 дена од приемот да поднесе приговор на записникот.`;

/** A minimal .docx: one stored-deflated `word/document.xml` with one paragraph per text line. */
function docx(text: string): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const xml = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${text.split('\n\n').map((p) => `<w:p><w:r><w:t>${esc(p.replace(/\n/g, ' '))}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
  const name = Buffer.from('word/document.xml');
  const data = deflateRawSync(Buffer.from(xml));
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(xml.length, 22); lh.writeUInt16LE(name.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(0, 42);
  const cdOff = lh.length + name.length + data.length;
  const cd = Buffer.concat([ch, name]);
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(cdOff, 16);
  return new Uint8Array(Buffer.concat([lh, name, data, cd, eo]));
}

async function doc(name: string, mime: string, body: Uint8Array) {
  const key = 'k/' + Math.random();
  bytes.set(key, body);
  const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: key, name, mime, size: body.length, sha256: 'x'.repeat(64), status: 'ready' }).returning();
  const [d] = await pg.insert(schema.aiDocuments).values({ firmId, fileId: f!.id, kind: 'kontrola', options: {} }).returning();
  return d!.id;
}
const load = async (id: string) => (await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id)))[0]!;

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'ТЕХНО ТРЕЈД ДООЕЛ', edb: '4030012345678' }).returning();
  firmId = f!.id;
  setObjectReader(async (k) => bytes.get(k) ?? new Uint8Array());
}, 60_000);
beforeEach(async () => { await pg.delete(schema.appSettings).where(eq(schema.appSettings.key, 'ai')); });
afterEach(() => { setAiClient(null); });

describe('kontrola read without AI (worker)', () => {
  it('.docx text: paragraphs', () => {
    expect(docxText(docx('А & Б\n\nВ'))).toBe('А & Б\n\nВ\n\n');
    expect(docxText(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('.txt and .docx acts are read by the free reader, AI is not called', async () => {
    const api = counting();
    setAiClient(api);
    for (const id of [await doc('zapisnik.txt', 'text/plain', new TextEncoder().encode(TXT)), await doc('zapisnik.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx(TXT))]) {
      await runReadDocument(db, id);
      const d = await load(id);
      expect(d).toMatchObject({ status: 'done', model: 'noai' });
      const r = d.result as KontrolaFreeResult;
      expect(r).toMatchObject({ auth: 'ujp', doc: 'zapisnik', docNo: '13-2451/4', docDate: '2026-03-14', periodFrom: '2025-01-01', periodTo: '2025-12-31', remedyDays: 8, noai: true });
      expect(r.findings!.map((f) => [f.claimed, f.article])).toEqual([['90000.00', 'член 53 став 8 од Законот за ДДВ'], ['21600.00', 'член 34 од Законот за ДДВ']]);
    }
    expect(api.n).toBe(0);
  });

  it('a photo with the AI credit exhausted: „скенирана слика – потребно е AI или рачен внес“ + why, retry stays possible', async () => {
    setAiClient(counting(CREDIT));
    const id = await doc('akt.jpg', 'image/jpeg', new Uint8Array([0xff, 0xd8, 0xff]));
    await runReadDocument(db, id);
    const d = await load(id);
    expect(d.status).toBe('error');
    expect(d.error).toMatch(/^Скенирана слика – потребно е AI или рачен внес/);
    expect(d.error).toMatch(/AI-кредитот е потрошен/);
    expect(d.options).toMatchObject({ errCode: 'credit' });
  });

  it('a PDF without a text layer and AI switched off: the same clear message', async () => {
    await setAiEnabled(db, false, null);
    const p = await PDFDocument.create(); p.addPage([595, 842]);
    const id = await doc('sken.pdf', 'application/pdf', await p.save());
    await runReadDocument(db, id);
    const d = await load(id);
    expect(d).toMatchObject({ status: 'error', options: { errCode: 'off' } });
    expect(d.error).toMatch(/Скенирана слика.*AI-читањето е исклучено/s);
    await setAiEnabled(db, true, null);
  });
});
