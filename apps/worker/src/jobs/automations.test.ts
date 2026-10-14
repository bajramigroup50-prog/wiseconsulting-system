import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { issueFeeInvoices, schema, seedReference, type DB } from '@wise/db';
import type { Mailer, OutgoingMail } from '../mail/mailer';
import { runNbrm } from '@wise/db';
import { runFeeDeliver } from './automations';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as DB;
let client = '';
const sent: OutgoingMail[] = [];
const mailer: Mailer = { from: 'WISE <office@wise.mk>', transport: { async sendMail(m) { sent.push(m); return { messageId: '<x@test>' }; } } };

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await seedReference(pg);
  await pg.insert(schema.firms).values({ name: 'БАЈРАМИ ГРОУП ДООЕЛ', edb: '4030000000001', settings: { officeFirm: true } });
  const [c] = await pg.insert(schema.firms).values({ name: 'Клиент ДООЕЛ', edb: '4030000000002', email: 'klient@example.mk', settings: { kdog: { net: 2000, start: '2026-01-01', no: 'СУ-001/2026' } } }).returning();
  client = c!.id;
}, 60_000);

const FIXTURE = (from: string) => JSON.stringify([
  { rBr: 189, datum: `${from}T00:00:00`, valuta: '978', oznaka: 'EUR', nomin: 1, sreden: 61.6866, nazivMak: 'евро' },
  { rBr: 189, datum: `${from}T00:00:00`, valuta: '840', oznaka: 'USD', nomin: 1, sreden: 55.1463, nazivMak: 'САД долар' },
]);

describe('nbrm.rates', () => {
  it('asks the service chunk by chunk (dd.MM.yyyy, JSON) and stores the rates', async () => {
    const urls: string[] = [];
    const r = await runNbrm(db, { from: '2026-08-01', to: '2026-10-09' }, async (u) => { urls.push(u); const m = u.match(/StartDate=(\d\d)\.(\d\d)\.(\d{4})/)!; return FIXTURE(`${m[3]}-${m[2]}-${m[1]}`); });
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe('https://www.nbrm.mk/KLServiceNOV/GetExchangeRate?StartDate=01.08.2026&EndDate=31.08.2026&format=json');
    expect(r).toMatchObject({ saved: 6, dates: 3 });
    const R = await pg.select().from(schema.fxRates).where(eq(schema.fxRates.cur, 'EUR'));
    expect(R.map((x) => [x.date, x.rate, x.source])).toEqual([['2026-08-01', '61.686600', 'nbrm'], ['2026-09-01', '61.686600', 'nbrm'], ['2026-10-02', '61.686600', 'nbrm']]);
  });
  it('a broken answer fails the job (pg-boss retries)', async () => {
    await expect(runNbrm(db, { from: '2026-10-01', to: '2026-10-02' }, async () => '<html>error</html>')).rejects.toThrow();
  });
});

describe('fee.deliver', () => {
  it('puts the PDF into the client portal message and e-mails it', async () => {
    const r = await issueFeeInvoices(db, { ym: '2026-10', date: '2026-10-30', userId: null });
    expect(r.issued).toHaveLength(1);
    const feeId = r.issued[0]!.feeId;
    const deps = { mail: { mailer, readFile: async () => Buffer.from('%PDF-1.4') }, render: async () => new Uint8Array([37, 80, 68, 70]), store: { put: async () => {} } };
    const d = await runFeeDeliver(db, feeId, deps);
    expect(d!.mail).toMatchObject({ status: 'sent', to: ['klient@example.mk'], entityType: 'fee_invoice' });
    const [f] = await pg.select().from(schema.files).where(eq(schema.files.id, d!.fileId));
    expect(f!.firmId).toBe(client);
    const [link] = await pg.select().from(schema.fileLinks).where(and(eq(schema.fileLinks.fileId, d!.fileId), eq(schema.fileLinks.entityType, 'inbox_item')));
    expect(link!.entityId).toBe(d!.portal);
    const [it] = await pg.select().from(schema.inboxItems).where(eq(schema.inboxItems.id, d!.portal!));
    expect(it).toMatchObject({ firmId: client, fromOffice: true });
    expect(it!.subject).toContain('сметководствени услуги за октомври 2026');
    const [fi] = await pg.select().from(schema.feeInvoices).where(eq(schema.feeInvoices.id, feeId));
    expect(fi!.mailedAt).toBeTruthy();
    expect(sent).toHaveLength(1);
    // without SMTP: portal only, no e-mail row
    const d2 = await runFeeDeliver(db, feeId, { ...deps, mail: { mailer: null } });
    expect(d2!.mail).toBeNull();
    expect(d2!.portal).toBe(d!.portal);
  });
});
