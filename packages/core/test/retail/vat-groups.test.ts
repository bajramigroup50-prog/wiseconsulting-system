import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { FISK_G0, fiskGroupWarnings, fkRows } from '../../src/ai/fisk';
import { toFiscalReceipt, vatGroup } from '../../src/retail/fiscal';
import { fkManualRead } from '../../src/retail/fisk-post';
import {
  FISCAL_VAT_GROUPS, FISCAL_VAT_GROUPS_OLD, FISCAL_VAT_RATES, VAT_GROUP_LETTERS, VAT_GROUPS_HINT,
  checkVatGroups, cleanVatGroups, groupLetter, remapGroup, vatGroupFor, vatGroupsLabel,
} from '../../src/retail/vat-groups';

// the desktop driver's CommonJS copy (desktop cannot import @wise/core)
const D = createRequire(import.meta.url)('../../../../desktop/fiscal/vat-groups.js') as typeof import('../../src/retail/vat-groups') & { isLegal(g: unknown): boolean };

describe('fiscal VAT groups (Правилник чл. 26, Сл. весник 315/2020, 60/2022)', () => {
  it('legal mapping А 18, Б 5, В 10, Г 0 — one constant for receipts, report reader and prompts', () => {
    expect(FISCAL_VAT_GROUPS).toEqual({ А: 18, Б: 5, В: 10, Г: 0 });
    expect(FISK_G0).toBe(FISCAL_VAT_GROUPS);
    expect([18, 5, 10, 0].map((r) => vatGroup(r))).toEqual(['А', 'Б', 'В', 'Г']);
    expect(vatGroupsLabel()).toBe('А 18 % · Б 5 % · В 10 % · Г 0 %');
    expect(Object.isFrozen(FISCAL_VAT_GROUPS)).toBe(true);
  });

  it('desktop copy equals the core module (constants and behaviour)', () => {
    expect(D.FISCAL_VAT_GROUPS).toEqual(FISCAL_VAT_GROUPS);
    expect(D.FISCAL_VAT_GROUPS_OLD).toEqual(FISCAL_VAT_GROUPS_OLD);
    expect([...D.VAT_GROUP_LETTERS]).toEqual([...VAT_GROUP_LETTERS]);
    expect([...D.FISCAL_VAT_RATES]).toEqual([...FISCAL_VAT_RATES]);
    expect(D.VAT_GROUPS_HINT).toBe(VAT_GROUPS_HINT);
    for (const g of [FISCAL_VAT_GROUPS, FISCAL_VAT_GROUPS_OLD, { А: 18, Б: 10, В: 5, Г: 0 }] as const) {
      for (const r of [18, 10, 5, 0, 7]) expect(D.vatGroupFor(r, g)).toBe(vatGroupFor(r, g));
      for (const L of VAT_GROUP_LETTERS) expect(D.remapGroup(L, g)).toBe(remapGroup(L, g));
      expect(D.checkVatGroups({ А: '18.00%', В: 0, G: 10 }, g)).toEqual(checkVatGroups({ А: '18.00%', В: 0, G: 10 }, g));
    }
    for (const bad of [{ В: 0 }, { X: 18 }, { А: 20 }, 'x']) expect(() => D.cleanVatGroups(bad)).toThrow((() => { try { cleanVatGroups(bad); } catch (e) { return (e as Error).message; } return 'no error'; })());
    expect(D.cleanVatGroups({ V: '0', G: '10%' })).toEqual(cleanVatGroups({ V: '0', G: '10%' }));
    expect(D.isLegal(FISCAL_VAT_GROUPS)).toBe(true);
    expect(D.isLegal(FISCAL_VAT_GROUPS_OLD)).toBe(false);
  });

  it('per-device override: validation and rate → device letter', () => {
    expect(cleanVatGroups(null)).toBe(FISCAL_VAT_GROUPS);
    const old = cleanVatGroups({ V: '0 %', Г: '10,00' });
    expect(old).toEqual(FISCAL_VAT_GROUPS_OLD);
    expect(() => cleanVatGroups({ В: 0 })).toThrow(/В и Г имаат иста стапка 0/);
    expect(() => cleanVatGroups({ А: 20 })).toThrow(/18, 10, 5 или 0/);
    expect(() => cleanVatGroups({ Д: 18 })).toThrow(/Непозната/);
    expect(groupLetter('g')).toBe('Г');
    expect([18, 5, 10, 0, 7].map((r) => vatGroup(r, old))).toEqual(['А', 'Б', 'Г', 'В', 'В']);
    // the page sends legal letters; the driver remaps them for a device with the old programming
    expect(VAT_GROUP_LETTERS.map((L) => remapGroup(L, old))).toEqual(['А', 'Б', 'Г', 'В']);
    expect(VAT_GROUP_LETTERS.map((L) => remapGroup(L, FISCAL_VAT_GROUPS))).toEqual([...VAT_GROUP_LETTERS]);
    const r = toFiscalReceipt([{ name: 'Кафе', qty: 1, price: 60, rate: 10 }, { name: 'Ослободено', qty: 1, price: 10, rate: 0 }]);
    expect(r.items.map((x) => x.vat)).toEqual(['В', 'Г']);
  });

  it('X report rates vs the settings', () => {
    expect(checkVatGroups({ А: '18.00%', Б: 5, В: 10, Г: 0 })).toEqual([]);
    expect(checkVatGroups({ А: 18, Б: 5, В: 0, Г: 10 })).toEqual(['Група В: на извештајот 0 %, очекувано 10 %.', 'Група Г: на извештајот 10 %, очекувано 0 %.']);
    expect(checkVatGroups({ А: 18, Б: 5, В: 0, Г: 10 }, FISCAL_VAT_GROUPS_OLD)).toEqual([]);
    expect(checkVatGroups({ А: 18, В: 0 }, FISCAL_VAT_GROUPS, ['А'])).toEqual([]);
    expect(checkVatGroups({ А: '', Б: null, Г: 'x' })).toEqual([]);
  });

  it('report reader: printed rates win, legal default otherwise, warning only for groups with turnover', () => {
    const plain = { to: '2026-03-31', totals: { gross: { А: 1180, В: 110 }, total: 1290 } };
    const X = fkRows(plain, '2026-04-01');
    expect(X.G).toEqual({ А: 18, Б: 5, В: 10, Г: 0 });
    expect(X.rows[0]!.vat).toEqual({ А: 180, В: 10 });
    expect(fiskGroupWarnings(plain)).toEqual([]);
    // an old device prints В 0 %, Г 10 %: its rates are used, and the difference is flagged for the groups in use
    const old = { to: '2026-03-31', groups: { А: 18, Б: 5, В: 0, Г: 10 }, totals: { gross: { А: 1180, Г: 110 }, total: 1290 } };
    const Y = fkRows(old, '2026-04-01');
    expect(Y.rows[0]!.vat).toEqual({ А: 180, Г: 10 });
    expect(fiskGroupWarnings(old)).toEqual(['Група Г: на извештајот 10 %, очекувано 0 %.']);
    expect(fiskGroupWarnings({ ...old, nonVat: true })).toEqual([]);
  });

  it('manual entry: Г is 0 % (with or without VAT status)', () => {
    const m = fkManualRead({ total: 500, from: '2026-03-01', to: '2026-03-31', group: 'Г' });
    expect(m.groups!['Г']).toBe(0);
    expect(fkManualRead({ total: 500, from: '2026-03-01', to: '2026-03-31', group: 'В' }).groups!['В']).toBe(10);
  });
});
