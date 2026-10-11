import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { complianceRows, kontrolaSummary, toCents, type Finding } from '@wise/core/compliance';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { audit } from './audit';
import { deleteInvoice, saveInvoice, type InvoiceInput } from './sales/invoices';
import type { DocActor } from './sales/context';
import {
  applyKontrolaAi, auditLogImmutable, complianceFacts, deleteKontrolaFinding, findingEvidence, invoiceLegalCheck, loadKontrola, saveKontrola,
  saveKontrolaAction, saveKontrolaFinding, seedProcessingActivities, setKontrolaActionDone,
} from './compliance';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
let firmId = '', cust = '', svc = '', userId = '';
const office: DocActor = { userId: null, role: 'acc' };
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };
const inv = (o: Partial<InvoiceInput> = {}): InvoiceInput => ({ kind: 'invoice', date: '2026-03-10', partnerId: cust, lines: [{ itemId: svc, name: 'Консалтинг', qty: 1, price: 1000, rate: 18 }], ...o });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Услуги ДООЕЛ', edb: '4030000000001', address: 'Ул. 1', city: 'Скопје' }).returning();
  firmId = f!.id;
  const [p] = await db.insert(schema.partners).values({ firmId, name: 'Купувач ДОО', code: '1', edb: '4002000000002', city: 'Битола' }).returning();
  cust = p!.id;
  const [i] = await db.insert(schema.items).values({ firmId, name: 'Консалтинг', code: '20', type: 'service', vatRate: 18 }).returning();
  svc = i!.id;
  const [u] = await db.insert(schema.users).values({ username: 'insp', name: 'Сметководител', passwordHash: 'x', role: 'acc' }).returning();
  userId = u!.id;
}, 120_000);

describe('audit log is append-only', () => {
  it('refuses UPDATE / DELETE / TRUNCATE but lets the foreign keys null a deleted user', async () => {
    expect(await auditLogImmutable(db)).toBe(true);
    const [tmp] = await db.insert(schema.users).values({ username: 'tmp', name: 'Привремен', passwordHash: 'x', role: 'view' }).returning();
    await audit(db, { userId: tmp!.id, firmId, action: 'test', data: { a: 1 } });
    const [row] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'test'));
    await err(db.update(schema.auditLog).set({ action: 'changed' }).where(eq(schema.auditLog.id, row!.id)));
    await err(db.update(schema.auditLog).set({ data: { a: 2 } }).where(eq(schema.auditLog.id, row!.id)));
    await err(db.delete(schema.auditLog).where(eq(schema.auditLog.id, row!.id)));
    await err(db.execute('truncate audit_log'));
    await db.delete(schema.users).where(eq(schema.users.id, tmp!.id)); // ON DELETE SET NULL is allowed
    const [after] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, row!.id));
    expect(after).toMatchObject({ action: 'test', userId: null, data: { a: 1 } });
  });
});

describe('invoices: retention lock and numbering', () => {
  it('deleting an issued invoice inside the series cancels it (number kept, journal reversed); the last one is deleted', async () => {
    const a = await tx((t) => saveInvoice(t, firmId, inv(), office));
    const b = await tx((t) => saveInvoice(t, firmId, inv({ date: '2026-03-11' }), office));
    const c = await tx((t) => saveInvoice(t, firmId, inv({ date: '2026-03-12' }), office));
    expect([a.number, b.number, c.number]).toEqual(['001/2026', '002/2026', '003/2026']);
    expect(await tx((t) => deleteInvoice(t, firmId, b.id, office, 'Погрешен купувач'))).toEqual({ cancelled: true });
    const [B] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, b.id));
    expect(B).toMatchObject({ number: '002/2026', status: 'draft' });
    expect((B!.data as schema.InvoiceData).cancelled).toMatchObject({ reason: 'Погрешен купувач', status: 'posted' });
    expect(await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'invoice'), eq(schema.journals.sourceId, b.id)))).toHaveLength(0);
    const [log] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'cancelDoc'), eq(schema.auditLog.entityId, b.id)));
    expect(log).toBeTruthy();
    // a cancelled invoice is frozen
    expect((await err(tx((t) => saveInvoice(t, firmId, inv({ id: b.id, date: '2026-03-11' }), office)))).message).toMatch(/сторнирана/);
    // the last number may go (no gap)
    expect(await tx((t) => deleteInvoice(t, firmId, c.id, office))).toEqual({ cancelled: false });
    // a new invoice continues after the cancelled one, and the numbering has no gap
    const d = await tx((t) => saveInvoice(t, firmId, inv({ date: '2026-03-13' }), office));
    expect(d.number).toBe('003/2026');
    const F = (await complianceFacts(db, firmId, 2026, '2026-03-20'))!;
    expect(F.numbering).toEqual([]);
    expect(F.cancelledCount).toBe(1);
    expect(F.invoiceCount).toBe(2);
  });
  it('a typed number that skips the sequence is saved with a warning', async () => {
    const r = await tx((t) => saveInvoice(t, firmId, inv({ number: '010/2026', date: '2026-03-14' }), office));
    expect(r.warnings.join(' ')).toMatch(/прескокнува/);
    const F = (await complianceFacts(db, firmId, 2026, '2026-03-20'))!;
    expect(F.numbering.map((n) => n.code)).toEqual(['gap']);
    expect(complianceRows(F).find((x) => x.id === 'inv_numbering')!.s).toBe('warn');
    await tx((t) => deleteInvoice(t, firmId, r.id, office));
  });
  it('mandatory elements: a VAT buyer without address blocks the document', async () => {
    const [p] = await db.insert(schema.partners).values({ firmId, name: 'Без адреса ДОО', code: '9', edb: '4002000000009' }).returning();
    const r = await tx((t) => saveInvoice(t, firmId, inv({ partnerId: p!.id, date: '2026-03-15' }), office));
    expect(r.warnings.join(' ')).toMatch(/задолжителни елементи/);
    const I = (await invoiceLegalCheck(db, r.id, '2026-03-20'))!;
    expect(I.filter((i) => i.sev === 'block').map((i) => i.code)).toEqual(['buyer_address']);
    expect((await invoiceLegalCheck(db, '00000000-0000-0000-0000-000000000000'))).toBeNull();
  });
});

describe('inspections register', () => {
  let kid = '';
  it('stores a decision, its findings and the AI read; validates input', async () => {
    expect((await err(tx((t) => saveKontrola(t, firmId, { auth: 'xxx', doc: 'reshenie' }, userId)))).message).toMatch(/орган/);
    expect((await err(tx((t) => saveKontrola(t, firmId, { auth: 'ujp', doc: 'reshenie', docDate: '2026-10-05', delivered: '2026-10-01' }, userId)))).message).toMatch(/пред датумот/);
    kid = await tx((t) => saveKontrola(t, firmId, { auth: 'ujp', doc: 'reshenie', docNo: '13-55/2', docDate: '2026-09-30', delivered: '2026-10-08', periodFrom: '2026-01-01', periodTo: '2026-03-31' }, userId));
    await tx((t) => saveKontrolaFinding(t, firmId, kid, { text: 'Неосновано одбиен претходен данок', area: 'vat', claimed: '50.000,00', interest: '1.250,50', ours: '10000' }, userId));
    const n = await tx((t) => applyKontrolaAi(t, firmId, kid, { subject: 'ДДВ контрола', findings: [{ text: 'Неевидентиран промет', area: 'books', claimed: '3000.00' }, { text: '' }, { text: 'Глоба', fine: 'xx' }] }, userId));
    expect(n).toBe(2);
    const { k, F } = await loadKontrola(db, firmId, kid);
    expect(k.subject).toBe('ДДВ контрола');
    expect(F.map((f) => [f.no, f.area, f.claimed, f.interest, f.fine, f.ours])).toEqual([
      [1, 'vat', '50000.00', '1250.50', '0.00', '10000.00'], [2, 'books', '3000.00', '0.00', '0.00', null], [3, 'vat', '0.00', '0.00', '0.00', null],
    ]);
    // aggregation over the stored findings (exact cents)
    const S = kontrolaSummary(F.map((f): Finding => ({ no: f.no, area: f.area as Finding['area'], text: f.text, claimed: toCents(f.claimed), interest: toCents(f.interest), fine: toCents(f.fine), ours: f.ours == null ? null : toCents(f.ours) })));
    expect(S).toMatchObject({ n: 3, claimed: 5_300_000, interest: 125_050, total: 5_425_050, disputed: 4_000_000, overall: 'partial' });
    await tx((t) => deleteKontrolaFinding(t, firmId, kid, F[2]!.id, userId));
    expect((await loadKontrola(db, firmId, kid)).F).toHaveLength(2);
  });
  it('links the evidence from the books: account balance and audit trail of the period', async () => {
    const ev = await findingEvidence(db, firmId, { periodFrom: '2026-01-01', periodTo: '2026-03-31', docDate: '2026-09-30' }, { area: 'invoice', account: '1200' });
    expect(ev.recalc!.source).toMatch(/конто 1200/);
    expect(ev.recalc!.cents).toBeGreaterThan(0);
    expect(ev.checks[0]!.s).toBe('ok');
    expect(ev.links.map((l) => l.href)).toContain('/izlez');
    expect(ev.audit.n).toBe(0); // audit rows carry the real time (2026-10), not the document dates
    const vat = await findingEvidence(db, firmId, { periodFrom: '2026-01-01', periodTo: '2026-03-31', docDate: null }, { area: 'vat', account: null });
    expect(vat.recalc).toBeNull();
    expect(vat.links.map((l) => l.href)).toContain('/ddv');
  });
  it('tracks deadlines and overdue corrective actions on the dashboard', async () => {
    const a = await tx((t) => saveKontrolaAction(t, firmId, kid, { text: 'Корекција на ДДВ-04', ownerId: userId, due: '2026-10-01' }, userId));
    const F = (await complianceFacts(db, firmId, 2026, '2026-10-11'))!;
    expect(F).toMatchObject({ kontrolaOpen: 1, kontrolaExpired: 0, actionsOverdue: 1, auditImmutable: true });
    const late = (await complianceFacts(db, firmId, 2026, '2026-10-27'))!;
    expect(late.kontrolaExpired).toBe(1); // 15 days from 08.10 → 23.10 holiday → 26.10
    await tx((t) => setKontrolaActionDone(t, firmId, a, '2026-10-10', userId));
    await tx((t) => saveKontrola(t, firmId, { id: kid, auth: 'ujp', doc: 'reshenie', delivered: '2026-10-08', docDate: '2026-09-30', filedOn: '2026-10-20', status: 'objected' }, userId));
    const after = (await complianceFacts(db, firmId, 2026, '2026-10-27'))!;
    expect(after).toMatchObject({ kontrolaOpen: 0, actionsOverdue: 0 });
  });
});

describe('personal data', () => {
  it('records the default processing activities once', async () => {
    expect(await tx((t) => seedProcessingActivities(t, firmId, userId))).toBe(6);
    expect(await tx((t) => seedProcessingActivities(t, firmId, userId))).toBe(0);
    expect((await complianceFacts(db, firmId, 2026, '2026-10-11'))!.activities).toBe(6);
  });
});
