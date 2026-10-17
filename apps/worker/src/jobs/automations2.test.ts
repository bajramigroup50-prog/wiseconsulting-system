import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_REPORT_AI_JOB } from '@wise/core/office';
import { AUTO_JOB, autoSettingsClean } from '@wise/core/office/automations';
import { putAutoSettings, schema, seedReference, type DB } from '@wise/db';
import { AUTOMATION_JOBS, autoClose, autoPayroll, autoReports } from './automations2';
import { remindersJob } from './reminders';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as DB;
const logs: string[] = [];
const sent: [string, object][] = [];
const ctx = { db, log: (m: string) => { logs.push(m); }, send: async (n: string, d: object) => { sent.push([n, d]); return null; } };

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await seedReference(pg);
  await pg.insert(schema.firms).values([
    { name: 'БАЈРАМИ ГРОУП ДООЕЛ', vatRegistered: false, settings: { officeFirm: true } },
    { name: 'Клиент ДООЕЛ', vatRegistered: false },
    { name: 'ДЕМО УСЛУГИ ДООЕЛ', vatRegistered: false, settings: { demo: true } },
  ]);
}, 60_000);

describe('scheduled automation jobs', () => {
  it('are registered with their Skopje cron schedules', () => {
    expect(Object.fromEntries(AUTOMATION_JOBS.map((j) => [j.name, j.cron]))).toEqual({
      [AUTO_JOB.close]: '10 2 * * *', [AUTO_JOB.lawrep]: '10 3 * * *', [AUTO_JOB.aml]: '0 4 * * 0', [AUTO_JOB.payroll]: '20 5 * * *',
      [AUTO_JOB.vat]: '40 5 * * *', [AUTO_JOB.reports]: '20 6 * * *', [AUTO_JOB.dunning]: '30 6 * * 1',
    });
  });
  it('switched off (the default): nothing is prepared', async () => {
    for (const j of AUTOMATION_JOBS) await j.run({ today: '2026-10-05' }, ctx);
    await remindersJob.run(null, ctx);
    expect(await pg.select().from(schema.automationDrafts)).toEqual([]);
    expect(await pg.select().from(schema.clientReports)).toEqual([]);
    expect(sent).toEqual([]);
  });
  it('the client reports with the AI summary switched on: drafts and the AI queued — never for the office or a demo firm', async () => {
    await putAutoSettings(db, autoSettingsClean({ on: { reports: true }, reportAi: true }), null);
    await autoReports.run({ today: '2026-10-05' }, ctx);
    const R = await pg.select().from(schema.clientReports);
    expect(R).toHaveLength(1);
    expect(R[0]).toMatchObject({ period: '2026-09', status: 'draft', aiStatus: 'queued' });
    expect(sent).toEqual([[CLIENT_REPORT_AI_JOB, { id: R[0]!.id }]]);
    // another day of the month: nothing
    await autoReports.run({ today: '2026-10-06' }, ctx);
    expect(sent).toHaveLength(1);
  });
  it('„▶ Пушти сега“ (force) runs a job outside its day', async () => {
    await putAutoSettings(db, autoSettingsClean({ on: { close: true, payroll: true } }), null);
    await autoPayroll.run({ today: '2026-10-09', force: true }, ctx);
    await autoClose.run({ today: '2026-10-09' }, ctx);
    const D = await pg.select().from(schema.automationDrafts);
    expect(D.map((d) => d.kind)).toEqual(['close', 'close']);
    expect(logs.some((l) => /ready 2\/2/.test(l))).toBe(true);
  });
});
