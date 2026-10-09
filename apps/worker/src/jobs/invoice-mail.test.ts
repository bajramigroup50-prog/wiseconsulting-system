import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { saveInvoice, schema, seedReference, type DB } from '@wise/db';
import type { Mailer, OutgoingMail } from '../mail/mailer';
import type { PdfInput } from '../pdf/document';
import { runInvoiceMail } from './invoice-mail';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as DB;
let firmId = '', invId = '';
const sent: OutgoingMail[] = [];
const mailer: Mailer = { from: 'WISE <office@wise.mk>', transport: { async sendMail(m) { sent.push(m); return { messageId: '<x@test>' }; } } };
const rendered: PdfInput[] = [];
const puts: string[] = [];

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await seedReference(pg);
  const [f] = await pg.insert(schema.firms).values({ name: 'Фактура ДОО', edb: '4030000000009' }).returning();
  firmId = f!.id;
  const [p] = await pg.insert(schema.partners).values({ firmId, name: 'Купувач', code: '1', email: 'kupuvac@example.mk' }).returning();
  const r = await pg.transaction((tx) => saveInvoice(tx as unknown as DB, firmId, {
    kind: 'invoice', date: '2026-05-04', due: '2026-05-19', partnerId: p!.id, lines: [{ name: 'Услуга', qty: 2, price: 500, rate: 18 }],
  }, { userId: null, role: 'acc' }));
  invId = r.id;
}, 60_000);

describe('invoice.mail', () => {
  it('renders the print template to a stored PDF and e-mails it to the buyer', async () => {
    const r = await runInvoiceMail(db, { invoiceId: invId }, {
      mail: { mailer, readFile: async () => Buffer.from('%PDF-1.4') },
      render: async (p) => { rendered.push(p); return new Uint8Array([37, 80, 68, 70]); },
      store: { put: async (key) => { puts.push(key); } },
    });
    expect(r).toMatchObject({ status: 'sent', to: ['kupuvac@example.mk'], entityType: 'invoice', entityId: invId });
    expect(rendered[0]!.html).toContain('pdfdoc');
    expect(rendered[0]!.css).toContain('.pdfdoc');
    expect(r!.subject).toMatch(/Фактура бр\..*Фактура ДОО/);
    const [f] = await pg.select().from(schema.files).where(eq(schema.files.id, r!.attachments[0]!));
    expect(f).toMatchObject({ firmId, mime: 'application/pdf', status: 'ready' });
    expect(sent[0]!.attachments).toHaveLength(1);
  });
  it('uses the given address / subject and ignores a missing document', async () => {
    const r = await runInvoiceMail(db, { invoiceId: invId, to: 'drug@example.mk', subject: 'Нова фактура' }, {
      mail: { mailer, readFile: async () => Buffer.from('%PDF') }, render: async () => new Uint8Array([1]), store: { put: async () => {} },
    });
    expect(r).toMatchObject({ to: ['drug@example.mk'], subject: 'Нова фактура' });
    expect(await runInvoiceMail(db, { invoiceId: '00000000-0000-0000-0000-000000000000' }, { mail: { mailer } })).toBeNull();
  });
});
