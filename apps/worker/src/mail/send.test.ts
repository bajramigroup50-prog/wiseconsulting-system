import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { schema, type DB } from '@wise/db';
import { mailerFromEnv, type Mailer, type OutgoingMail } from './mailer';
import { sendLoggedMail } from './send';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as DB;
let firmId = '';
const sent: OutgoingMail[] = [];
const mock: Mailer = { from: 'WISE <office@wise.mk>', transport: { async sendMail(m) { sent.push(m); return { messageId: '<m' + sent.length + '@test>' }; } } };

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Mail ДОО' }).returning();
  firmId = f!.id;
}, 60_000);

describe('mail.send', () => {
  it('sends through the transport and logs the message', async () => {
    const r = await sendLoggedMail(db, { firmId, to: 'ana@firma.mk; boris@firma.mk', subject: 'Пресметка', html: '<b>x</b>', entityType: 'payroll_emp', entityId: 'e1' }, { mailer: mock });
    expect(r).toMatchObject({ status: 'sent', messageId: '<m1@test>', attempts: 1, to: ['ana@firma.mk', 'boris@firma.mk'] });
    expect(sent[0]).toMatchObject({ from: 'WISE <office@wise.mk>', subject: 'Пресметка', html: '<b>x</b>' });
    // a retried job does not send twice
    await sendLoggedMail(db, { logId: r.id }, { mailer: mock });
    expect(sent).toHaveLength(1);
  });

  it('fails gracefully without SMTP configuration', async () => {
    expect(mailerFromEnv({})).toBeNull();
    const r = await sendLoggedMail(db, { firmId, to: 'ana@firma.mk', subject: 's', html: 'h' }, { mailer: null });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/SMTP/);
  });

  it('rejects bad addresses and logs SMTP errors', async () => {
    expect((await sendLoggedMail(db, { firmId, to: 'not-an-address', subject: 's', html: 'h' }, { mailer: mock })).error).toMatch(/Неважечка/);
    const boom: Mailer = { from: 'x@y.mk', transport: { async sendMail() { throw new Error('550 rejected'); } } };
    const r = await sendLoggedMail(db, { firmId, to: 'a@b.mk', subject: 's', html: 'h' }, { mailer: boom });
    expect(r).toMatchObject({ status: 'failed', error: 'SMTP: 550 rejected' });
  });

  it('attaches uploaded files of the same firm only', async () => {
    const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: 'firms/x/2026/a.pdf', name: 'a.pdf', mime: 'application/pdf', size: 3, sha256: 'x', status: 'ready' }).returning();
    const r = await sendLoggedMail(db, { firmId, to: 'a@b.mk', subject: 's', html: 'h', attachments: [f!.id] }, { mailer: mock, readFile: async () => Buffer.from('pdf') });
    expect(r.status).toBe('sent');
    expect(sent.at(-1)!.attachments).toEqual([{ filename: 'a.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' }]);
    const [g] = await pg.insert(schema.firms).values({ name: 'Друга' }).returning();
    const x = await sendLoggedMail(db, { firmId: g!.id, to: 'a@b.mk', subject: 's', html: 'h', attachments: [f!.id] }, { mailer: mock, readFile: async () => Buffer.from('pdf') });
    expect(x.status).toBe('failed');
    const rows = await pg.select().from(schema.mailLog).where(eq(schema.mailLog.firmId, firmId));
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it('reads SMTP settings from the environment', () => {
    const m = mailerFromEnv({ SMTP_HOST: 'smtp.example.mk', SMTP_PORT: '465', SMTP_USER: 'office@example.mk', SMTP_PASS: 'x' });
    expect(m?.from).toBe('office@example.mk');
    expect(mailerFromEnv({ SMTP_URL: 'smtp://u%40x.mk:p@smtp.x.mk:587', MAIL_FROM: 'WISE <o@x.mk>' })?.from).toBe('WISE <o@x.mk>');
  });
});
