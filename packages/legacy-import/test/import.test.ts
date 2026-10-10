import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { schema, type Tx } from '@wise/db';
import { parseBackupJson } from '../src/format';
import { importBundle, importFirm, type FileSink } from '../src/writer';
import { fixtureBackup } from './fixture';
import { testDb } from '../src/testing';

let db: Tx;
const stored = new Map<string, Uint8Array>();
const sink: FileSink = { async put(k, b) { stored.set(k, b); } };
const bundle = () => parseBackupJson(fixtureBackup(), 'Rezervna_kopija.zip › TEST_mf1abc.json');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const count = async (t: any, firmId: string) => {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.firmId, firmId));
  return r!.n;
};

beforeAll(async () => { db = await testDb(); }, 120_000);

describe('firm import', () => {
  let firmId = '';

  it('imports one firm with masters, documents, journals and a matching trial balance', async () => {
    const r = await importFirm(db, bundle().firms[0]!, { userId: null, files: sink });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe('created');
    firmId = r.firmId!;
    expect(r.trialBalance.ok).toBe(true);
    expect(r.trialBalance.diffs).toEqual([]);
    expect(r.journals.failed).toBe(0);
    expect(r.counts).toMatchObject({ partners: 3, items: 1, employees: 1, invoices: 3, purchases: 1, bank_statements: 1, bank_lines: 2, sales_daily: 1, payroll_runs: 1, stock_moves: 2, fixed_assets: 1, fleet_vehicles: 1, cash_vouchers: 1, hotel_rooms: 1, dossier_docs: 1, bank_rules: 2 });
    expect(r.firmDocs).toEqual({ loan: 1 });
    expect(r.files).toEqual({ imported: 1, unavailable: 1 });
    expect(stored.size).toBe(1);
    // duplicate partner code → second one imported without a code
    expect(r.warnings.join('\n')).toMatch(/шифрата 1 е зафатена/);

    const [f] = await db.select().from(schema.firms).where(eq(schema.firms.id, firmId));
    expect(f).toMatchObject({ legacyId: 'mf1abc', edb: '4030999000001', lockDate: '2026-03-31', vatPeriod: 'quarter' });
    expect((f!.settings as { banks: { id: string }[] }).banks[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    const vp = await db.select().from(schema.vatPeriods).where(eq(schema.vatPeriods.firmId, firmId));
    expect(vp.map((p) => [p.period, p.status, !!p.closingJournalId])).toEqual([['2026-Т1', 'closed', true]]);
    const inv = await db.select().from(schema.invoices).where(eq(schema.invoices.firmId, firmId));
    const credit = inv.find((i) => i.kind === 'credit')!;
    expect(credit.refInvoiceId).toBe(inv.find((i) => i.kind === 'invoice')!.id);
    // the invoice journal is linked to the imported invoice (source type of the sales module)
    const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, 'invoice'), eq(schema.journals.sourceId, credit.refInvoiceId!)));
    expect(j!.kind).toBe('izlez');
    const stockJ = await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, 'stock:invoice')));
    expect(stockJ).toHaveLength(1);
    // the account unknown to the chart was added to the firm's chart
    expect(r.warnings.join('\n')).toMatch(/99999/);
    const audits = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, 'legacyImport')));
    expect(audits).toHaveLength(1);
  });

  it('re-importing the same backup duplicates nothing and keeps the trial balance', async () => {
    const before = { p: await count(schema.partners, firmId), i: await count(schema.invoices, firmId), j: await count(schema.journals, firmId), m: await count(schema.stockMoves, firmId), d: await count(schema.firmDocs, firmId), l: await count(schema.bankLines, firmId) };
    const r = await importFirm(db, bundle().firms[0]!, { userId: null, files: sink });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe('updated');
    expect(r.firmId).toBe(firmId);
    expect(r.trialBalance.ok).toBe(true);
    expect(r.journals.failed).toBe(0);
    const after = { p: await count(schema.partners, firmId), i: await count(schema.invoices, firmId), j: await count(schema.journals, firmId), m: await count(schema.stockMoves, firmId), d: await count(schema.firmDocs, firmId), l: await count(schema.bankLines, firmId) };
    expect(after).toEqual(before);
    expect((await db.select().from(schema.firms)).filter((f) => f.legacyId === 'mf1abc')).toHaveLength(1);
    const [vp] = await db.select().from(schema.vatPeriods).where(eq(schema.vatPeriods.firmId, firmId));
    expect(vp!.status).toBe('closed');
    expect(stored.size).toBe(1); // the logo is not uploaded twice
  });

  it('a record that cannot be imported is skipped with its reason; the rest of the firm is imported', async () => {
    const b = bundle().firms[0]!;
    const r = await importFirm(db, { ...b, firm: { ...b.firm, id: 'other-firm', edb: '4030999000002' }, data: { ...b.data, payroll: [{ id: 'x', month: '2026-13' }] } }, { userId: null });
    expect(r.status).toBe('created');
    expect(r.skipped.find((s) => /Плата/.test(s.what))!.reason).toMatch(/нема месец/);
    expect(r.counts.invoices).toBe(3);
  });

  it('imports a whole bundle with users (legacy hashes kept, firm access mapped)', async () => {
    const fx = fixtureBackup();
    const b = parseBackupJson({
      kind: 'wise-legacy-export', at: fx.at, firms: [{ firm: fx.firm, data: fx.data }],
      appusers: [{ id: 'u1', username: 'ana', name: 'Ана', role: 'acc', firms: ['mf1abc'], salt: 'abc', hash: 'p2$150000$00', pw0: 'x' }, { id: 'u2', username: 'bez' }],
      settings: { 'appsettings/fx': { rows: [{ cur: 'EUR', rate: 61.6, date: '2026-10-01' }] } },
    }, 'all.json');
    const rep = await importBundle(db, b, { userId: null });
    expect(rep.firms[0]!.status).toBe('updated');
    expect(rep.users).toMatchObject({ imported: 1 });
    expect(rep.users!.skipped[0]!.reason).toMatch(/лозинка/);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.username, 'ana'));
    expect(u).toMatchObject({ passwordHash: 'p2$150000$00', legacySalt: 'abc', role: 'acc' });
    const uf = await db.select().from(schema.userFirms).where(eq(schema.userFirms.userId, u!.id));
    expect(uf.map((x) => x.firmId)).toEqual([firmId]);
    expect(rep.settings.join('\n')).toMatch(/Курсна листа: 1/);
    const again = await importBundle(db, b, { userId: null });
    expect(again.users).toMatchObject({ imported: 0, updated: 1 });
  });
});
