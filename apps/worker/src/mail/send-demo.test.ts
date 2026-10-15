/** 🎭 The worker never mails anything of a demo firm or a demo user (second line of defence behind the web). */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_OFF_MSG } from '@wise/core/demo';
import { schema, type DB } from '@wise/db';
import type { Mailer, OutgoingMail } from './mailer';
import { sendLoggedMail } from './send';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as DB;
const sent: OutgoingMail[] = [];
const mock: Mailer = { from: 'WISE <office@wise.mk>', transport: { async sendMail(m) { sent.push(m); return { messageId: '<x@test>' }; } } };
let demoFirm = '', realFirm = '', misflagged = '', demoUser = '';

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  demoFirm = (await pg.insert(schema.firms).values({ name: 'ДЕМО ТРГОВИЈА ДООЕЛ', settings: { demo: true } }).returning())[0]!.id;
  realFirm = (await pg.insert(schema.firms).values({ name: 'Клиент ДОО' }).returning())[0]!.id;
  misflagged = (await pg.insert(schema.firms).values({ name: 'Клиент 2 ДОО', settings: { demo: true } }).returning())[0]!.id;
  demoUser = (await pg.insert(schema.users).values({ username: 'demo', name: 'Демо', role: 'admin', demo: true, passwordHash: 'x' }).returning())[0]!.id;
}, 60_000);

describe('mail of demo firms / users', () => {
  it('is refused and logged as failed', async () => {
    const a = await sendLoggedMail(db, { firmId: demoFirm, to: 'buyer@example.com', subject: 's', html: 'h' }, { mailer: mock });
    expect(a).toMatchObject({ status: 'failed', error: DEMO_OFF_MSG });
    const b = await sendLoggedMail(db, { firmId: null, to: 'buyer@example.com', subject: 's', html: 'h', userId: demoUser }, { mailer: mock });
    expect(b).toMatchObject({ status: 'failed', error: DEMO_OFF_MSG });
    expect(sent).toHaveLength(0);
  });
  it('real firms (also a misflagged one without the „ДЕМО“ name) still send', async () => {
    expect((await sendLoggedMail(db, { firmId: realFirm, to: 'a@b.mk', subject: 's', html: 'h' }, { mailer: mock })).status).toBe('sent');
    expect((await sendLoggedMail(db, { firmId: misflagged, to: 'a@b.mk', subject: 's', html: 'h' }, { mailer: mock })).status).toBe('sent');
  });
});
