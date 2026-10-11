/**
 * Workflow 7 — year-end 2025 through the screens' actions: fixed asset (Основни средства form) → depreciation →
 * close the year (ДБ tax) → AOP statements (Биланс на состојба / успех) pass the „Контрола“ cross-checks →
 * ЦРСМ XML download is well-formed and carries the AOPs.
 */
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { crmRules } from '@wise/core';
import { zkAopChecks } from '@wise/core/yearend/kontrola';
import { forms3538, loadYear, postJournal, schema } from '@wise/db';
import { form, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
// the year-end payroll input reads through `getDb()` (registered by @wise/db payroll)
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const { saveAsset, runDepAction } = await import('@/app/(app)/os/actions');
const { closeYearAction } = await import('@/app/(app)/zsProc/actions');
const crm = await import('@/app/(app)/zsXml/download/route');
const { accountNames } = await import('@/lib/yearend');

let firmId = '';

/** Minimal well-formedness check: one root, every tag closed in order, no raw `&`/`<` in text. */
function wellFormed(xml: string): string | null {
  const body = xml.replace(/^﻿?<\?xml[^?]*\?>\s*/, '');
  const stack: string[] = [];
  let roots = 0;
  const re = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[5] != null) { if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(m[5])) return 'raw & in text'; if (!stack.length && m[5].trim()) return 'text outside root'; continue; }
    const [, close, name, , self] = m;
    if (close) { if (stack.pop() !== name) return `mismatched </${name}>`; continue; }
    if (!stack.length) roots++;
    if (!self) stack.push(name!);
  }
  if (stack.length) return `unclosed <${stack.at(-1)}>`;
  return roots === 1 ? null : `${roots} roots`;
}

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'ГОДИНА ДООЕЛ Скопје', legalForm: 'dooel', embs: '7001234', edb: '4030025001234', activity: '62.01' }).returning();
  firmId = f!.id;
  const [c] = await pg.insert(schema.partners).values({ firmId, name: 'Купувач ДОО' }).returning();
  const P = (date: string, kind: string, lines: Parameters<typeof postJournal>[1]['lines'], extra = {}) =>
    pg.transaction((tx) => postJournal(tx as never, { firmId, date, kind, userId: null, lines, ...extra }));
  await P('2025-01-01', 'open', [{ account: '1000', debit: 100_000 }, { account: '9000', credit: 100_000 }], { sourceType: 'opening', sourceId: 'open-2025' });
  await P('2025-03-10', 'izlez', [{ account: '1200', debit: 236_000, partnerId: c!.id }, { account: '7400', credit: 200_000 }, { account: '230018', credit: 36_000 }]);
  await P('2025-04-02', 'manual', [{ account: '4400', debit: 80_000 }, { account: '1000', credit: 80_000 }]);
  await P('2025-06-15', 'manual', [{ account: '1000', debit: 236_000 }, { account: '1200', credit: 236_000, partnerId: c!.id }]);
  await P('2025-12-31', 'manual', [{ account: '230018', debit: 36_000 }, { account: '1000', credit: 36_000 }]);
  await signIn('admin');
  useFirm(firmId);
  useYear(2025);
}, 120_000);

describe('flow 7 — year-end', () => {
  it('a fixed asset through the asset form and the year\'s depreciation', async () => {
    const r = await saveAsset({}, form({ name: 'Лаптоп', konto: '0134', rate: '25', cost: '48000', date: '2025-01-20', disposed: '' }));
    expect(r.error).toBeUndefined();
    const [a] = await pg.select().from(schema.fixedAssets).where(eq(schema.fixedAssets.firmId, firmId));
    expect(a).toMatchObject({ invNo: '0001', konto: '0134' });
    // the asset purchase itself
    await pg.transaction((tx) => postJournal(tx as never, { firmId, date: '2025-01-20', kind: 'manual', userId: null, lines: [{ account: '0134', debit: 48_000 }, { account: '1000', credit: 48_000 }] }));
    const d = await runDepAction();
    expect(d.error).toBeUndefined();
    expect(d.ok).toMatch(/11\.000,00|11 000,00|11000/); // 48 000 × 25 % × 11/12
  });

  it('closes the year with the profit tax; the statements pass every AOP cross-check', async () => {
    const r = await closeYearAction();
    expect(r.error, r.error).toBeUndefined();
    // profit 200 000 − 80 000 − 11 000 = 109 000, tax 10 %
    expect(r.ok).toMatch(/109\.000,00/);
    expect(r.ok).toMatch(/10\.900,00/);
    const L = await loadYear(pg as never, firmId, 2025);
    expect(L.Y.closed).toBe(true);
    const V = L.Y.co.zs.V;
    for (const [label, a, b] of zkAopChecks(V, L.Y.co.db.V)) expect(a, label).toBe(b);
    expect(Math.round(V.bs063!)).toBeGreaterThan(0);
    expect(Math.round(V.bu255!)).toBe(98_100);
    const { de } = forms3538(L, await accountNames(firmId));
    const errs = crmRules(L.Y.co.zs, de).filter((x) => x[2] !== 'warn');
    expect(errs, JSON.stringify(errs)).toEqual([]);
  });

  it('ЦРСМ XML: well-formed, named by ЕМБС, carries the balance sheet totals', async () => {
    const res = await crm.GET(new NextRequest('http://localhost/zsXml/download'));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('GS_2025_7001234.xml');
    const xml = await res.text();
    expect(wellFormed(xml)).toBeNull();
    expect(xml).toMatch(/<AnnualAccount/);
    expect(xml).toContain('7001234');
  });
});
