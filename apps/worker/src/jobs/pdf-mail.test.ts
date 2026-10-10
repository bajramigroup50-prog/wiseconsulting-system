import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { mailWaitsForAttachments, queueMailRow, schema, type DB, type Tx } from '@wise/db';
import type { Mailer, OutgoingMail } from '../mail/mailer';
import { runPdfMail } from './pdf-mail';
import { renderPdfToFile } from './pdf';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as DB;
let firmId = '';
const sent: OutgoingMail[] = [];
const mailer: Mailer = { from: 'WISE <office@wise.mk>', transport: { async sendMail(m) { sent.push(m); return { messageId: '<x@test>' }; } } };
const store = { put: async () => {} };

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Опомена ДОО', edb: '4030000000017' }).returning();
  firmId = f!.id;
}, 60_000);

describe('pdf.mail', () => {
  it('renders the letter into the pre-allocated file and sends the queued row with it attached', async () => {
    const fileId = randomUUID();
    const logId = await queueMailRow(db as unknown as Tx, { firmId, to: 'kupuvac@example.mk', subject: '1. опомена', html: '<p>Почитувани</p>', attachments: [fileId], entityType: 'dunning', userId: null });
    let renders = 0;
    const deps = { mail: { mailer, readFile: async () => Buffer.from('%PDF-1.4') }, render: async () => { renders++; return new Uint8Array([37, 80, 68, 70]); }, store };
    const r = await runPdfMail(db, { logId, fileId, html: '<div class="pdfdoc">опомена</div>', title: 'Opomena 1', firmId }, deps);
    expect(r).toMatchObject({ id: logId, status: 'sent', attachments: [fileId] });
    const [f] = await pg.select().from(schema.files).where(eq(schema.files.id, fileId));
    expect(f).toMatchObject({ firmId, mime: 'application/pdf', status: 'ready', name: 'Opomena 1.pdf' });
    expect(sent.at(-1)!.attachments).toHaveLength(1);
    // a retried job neither renders nor sends again
    await runPdfMail(db, { logId, fileId, html: 'x', title: 'Opomena 1', firmId }, deps);
    expect(renders).toBe(1);
    expect(sent).toHaveLength(1);
  });
});

describe('pdf.render link', () => {
  it('files the stored PDF (dossier / year dossier, replacing the role)', async () => {
    const key = `${firmId}:2025`;
    const a = await renderPdfToFile(db, { html: '<p>БС</p>', title: 'BS 2025', firmId, link: { entityType: 'ye_dossier', entityId: key, role: 'bs', replace: true } }, { render: async () => new Uint8Array([1]), store });
    const b = await renderPdfToFile(db, { html: '<p>БС 2</p>', title: 'BS 2025', firmId, link: { entityType: 'ye_dossier', entityId: key, role: 'bs', replace: true } }, { render: async () => new Uint8Array([2]), store });
    await renderPdfToFile(db, { html: '<p>ДБ</p>', title: 'DB 2025', firmId, link: { entityType: 'ye_dossier', entityId: key, role: 'db', replace: true } }, { render: async () => new Uint8Array([3]), store });
    const L = await pg.select().from(schema.fileLinks).where(and(eq(schema.fileLinks.entityType, 'ye_dossier'), eq(schema.fileLinks.entityId, key)));
    expect(L.filter((l) => l.role === 'bs').map((l) => l.fileId)).toEqual([b]);
    expect(L.some((l) => l.fileId === a)).toBe(false);
    expect(L.filter((l) => l.role === 'db')).toHaveLength(1);
  });
});

describe('mail.flush and PDFs still rendering', () => {
  it('waits for a missing attachment for 30 minutes, then lets the send fail visibly', () => {
    const now = new Date('2026-10-10T10:00:00Z');
    const row = (min: number, attachments = ['f1']) => ({ attachments, createdAt: new Date(now.getTime() - min * 60_000) });
    expect(mailWaitsForAttachments(row(5), new Set(), now)).toBe(true);
    expect(mailWaitsForAttachments(row(5), new Set(['f1']), now)).toBe(false);
    expect(mailWaitsForAttachments(row(31), new Set(), now)).toBe(false);
    expect(mailWaitsForAttachments(row(5, []), new Set(), now)).toBe(false);
  });
});
