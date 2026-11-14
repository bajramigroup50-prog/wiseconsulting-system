/**
 * „✉ Е-пошта → WISE“ (`mail.in`, IMAP replaced by a fixed channel, storage mocked): attachments land in „Пристигнати
 * документи“ of the right firm (client user's e-mail, ЕДБ), an unknown sender waits in the office inbox, logos and the
 * mailbox's own mails are skipped, a re-read is not stored twice, and giving a mail to a firm remembers the sender.
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignIncomingFirm, mailInConfig, mailInSenders, saveMailIn, schema, type DB, type Tx } from '@wise/db';
import { runMailIn, type MailChannel, type MailMsg } from './mail-in';

process.env.SOCIAL_SECRET ||= 'test-secret-for-mail-in-0123456789';
const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
const store = { async put() {} };
let agro = '', trimi = '', userId = '';
const pdf = (s: string) => new TextEncoder().encode('%PDF-1.4 ' + s + ' '.repeat(2000));
const msg = (uid: number, from: string, subject: string, parts: MailMsg['parts'], text = ''): MailMsg => ({ uid, from, fromName: null, subject, text, date: null, msgId: `<m${uid}@x>`, parts });

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  [{ id: agro }] = await pg.insert(schema.firms).values({ name: 'АГРО ФАРМА ЛТД ДООЕЛ', edb: '4030000000001' }).returning({ id: schema.firms.id });
  [{ id: trimi }] = await pg.insert(schema.firms).values({ name: 'ТРИМИ МЕТАЛ ДООЕЛ', edb: '4030000000002' }).returning({ id: schema.firms.id });
  await pg.insert(schema.firms).values({ name: 'БАЈРАМИ ГРОУП ДООЕЛ', edb: '4030999999999', settings: { officeFirm: true } });
  const [k] = await pg.insert(schema.users).values({ username: 'k-agro', name: 'Клиент', role: 'klient', passwordHash: 'x', email: 'Shef@Agro.mk' }).returning();
  await pg.insert(schema.userFirms).values({ userId: k!.id, firmId: agro });
  const [o] = await pg.insert(schema.users).values({ username: 'owner', name: 'Сопственик', role: 'admin', passwordHash: 'x' }).returning();
  userId = o!.id;
  await saveMailIn(db, { on: true, host: 'arya.mk-host.mk', user: 'info@wiseconsulting.com.mk', pass: 'secret', days: 30 }, userId);
});

describe('mail.in', () => {
  it('saves the mailbox without showing the password', async () => {
    const c = await mailInConfig(db);
    expect(c).toMatchObject({ on: true, host: 'arya.mk-host.mk', user: 'info@wiseconsulting.com.mk', port: 993, hasPass: true });
    expect(JSON.stringify(c)).not.toContain('secret');
  });

  it('files the attachments by firm, waits when unsure, skips logos and own mails', async () => {
    const ch: MailChannel = { uidValidity: '7', listed: 4, messages: [
      msg(1, 'shef@agro.mk', 'фактури', [{ name: 'f1.pdf', mime: 'application/pdf', bytes: pdf('a') }, { name: 'logo.png', mime: 'image/png', bytes: new Uint8Array(500) }]),
      msg(2, 'dadikompani@yahoo.com', 'ФРИ', [{ name: 'fra.pdf', mime: 'application/pdf', bytes: pdf('b') }], 'Купувач: ЕДБ MK4030000000002'),
      msg(3, 'nepoznat@gmail.com', 'документи', [{ name: 'x.pdf', mime: 'application/pdf', bytes: pdf('c') }]),
      msg(4, 'info@wiseconsulting.com.mk', 'Re: x', [{ name: 'y.pdf', mime: 'application/pdf', bytes: pdf('d') }]),
    ] };
    const sent: object[] = [];
    const r = await runMailIn(db as unknown as DB, { channel: ch, store, send: async (_n, d) => { sent.push(d); } });
    expect(r).toContain('3 документи');
    const D = await pg.select().from(schema.incomingDocs).where(eq(schema.incomingDocs.source, 'mail'));
    expect(D).toHaveLength(3);
    expect(D.find((d) => d.what === 'фактури')?.firmId).toBe(agro);
    expect(D.find((d) => d.what === 'ФРИ')?.firmId).toBe(trimi);
    const w = D.find((d) => d.what === 'документи')!;
    expect(w.firmId).toBeNull();
    expect(w.result).toContain('изберете фирма');
    expect(sent).toHaveLength(3);
    expect((await mailInConfig(db)).lastUid).toBe(4);
  });

  it('a mail read again is not stored twice', async () => {
    const ch: MailChannel = { uidValidity: '7', listed: 1, messages: [msg(1, 'shef@agro.mk', 'фактури', [{ name: 'f1.pdf', mime: 'application/pdf', bytes: pdf('a') }])] };
    const r = await runMailIn(db as unknown as DB, { channel: ch, store });
    expect(r).toContain('веќе преземени');
    expect(await pg.select().from(schema.incomingDocs).where(eq(schema.incomingDocs.source, 'mail'))).toHaveLength(3);
  });

  it('giving a mail to a firm remembers the sender; the next mail goes there by itself', async () => {
    const [w] = await pg.select().from(schema.incomingDocs).where(eq(schema.incomingDocs.what, 'документи'));
    await assignIncomingFirm(db, { id: w!.id, from: null, to: agro, userId });
    expect((await mailInSenders(db))['nepoznat@gmail.com']).toBe(agro);
    const ch: MailChannel = { uidValidity: '7', listed: 1, messages: [msg(5, 'Nepoznat <nepoznat@gmail.com>', 'нови', [{ name: 'z.pdf', mime: 'application/pdf', bytes: pdf('e') }])] };
    await runMailIn(db as unknown as DB, { channel: ch, store });
    const [n] = await pg.select().from(schema.incomingDocs).where(eq(schema.incomingDocs.what, 'нови'));
    expect(n!.firmId).toBe(agro);
    expect((n!.detect as { mailHow?: string }).mailHow).toBe('learned');
  });
});
