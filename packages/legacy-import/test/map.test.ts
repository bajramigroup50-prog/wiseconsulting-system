import { describe, expect, it } from 'vitest';
import * as M from '../src/map';
import { fixtureBackup } from './fixture';
import { num, isoDate } from '../src/util';

const fx = fixtureBackup();
const R: M.Resolve = (kind, id) => (id == null || id === '' || id === 'main' ? null : `${kind}#${String(id)}`);

describe('mappers', () => {
  it('firm: columns, effective scheme, remaining fields in settings, images not in settings', () => {
    const f = M.mapFirm(fx.firm);
    expect(f).toMatchObject({ legacyId: 'mf1abc', name: 'ТЕСТ ТРГОВИЈА ДООЕЛ', legalForm: 'dooel', vatRegistered: true, vatPeriod: 'quarter', lockDate: '2026-03-31', mods: ['hotel'] });
    expect(f.settings).toMatchObject({ invColor: '#123456', crMode: 'minus', banks: fx.firm.banks });
    expect(f.settings).not.toHaveProperty('logo');
    expect(M.mapAccountOverrides({ id: 'x', accounts: { '10001': { mk: 'Жиро 2' }, '002': null, 'abc': { mk: 'x' } } })).toEqual([
      { code: '10001', name: 'Жиро 2', nameSq: null, hidden: false }, { code: '002', name: '002', nameSq: null, hidden: true },
    ]);
  });

  it('partner: leaked item defaults (rate/konto/type) are dropped, extra fields kept', () => {
    const p = M.mapPartner(fx.data.partners[0]!);
    expect(p).toMatchObject({ code: '1', name: 'Купувач ДОО', edb: '4030000000011', vatRegistered: true });
    expect(p.data).toEqual({ manager: 'Марко' });
  });

  it('invoice: kind, totals from the lines, typed strings parsed, links for the second pass', () => {
    const v = M.mapInvoice(fx.data.invoices[0]!, R, true);
    expect(v.head).toMatchObject({ kind: 'invoice', status: 'posted', number: '1/2026', date: '2026-02-01', partnerId: 'partner#p1', warehouseId: null, base: '2000.00', vat: '360.00', total: '2360.00' });
    expect(v.lines[0]).toMatchObject({ itemId: 'item#i1', qty: '2.0000', price: '1000.0000', rate: 18, account: '7400' });
    const c = M.mapInvoice(fx.data.invoices[1]!, R, true);
    expect(c.head.kind).toBe('credit');
    expect(c.refInvoice).toBe('inv1');
    expect(M.mapInvoice(fx.data.invoices[2]!, R, true).head.status).toBe('pending');
    expect(() => M.mapInvoice({ id: 'x', number: '1' }, R, true)).toThrow(M.MapSkip);
  });

  it('purchase: VAT groups, stock lines without an item are reported', () => {
    const v = M.mapPurchase({ ...fx.data.purchases[0]!, stock: [...fx.data.purchases[0]!.stock, { name: 'Без артикл', qty: 1 }] }, R);
    expect(v.head).toMatchObject({ ptype: 'stock', base: '6000.00', vat: '1080.00', total: '7080.00', partnerId: 'partner#p2' });
    expect(v.groups).toEqual([{ lineNo: 1, account: '6600', rate: 18, base: '6000.00', vat: '1080.00' }]);
    expect(v.stockLines).toHaveLength(1);
    expect(v.skipped[0]).toMatch(/нема артикл/);
  });

  it('move sources: purchase / invoice / dispatch / transfer / legacy fallback', () => {
    const docs = { transfer: (s: string) => (s === 'prn-9' ? 'T9' : null), stockCount: () => null, production: () => null, salesDay: () => null };
    expect(M.moveSource('pur-pur1', R, docs)).toEqual({ sourceType: 'purchase', sourceId: 'purchase#pur1' });
    expect(M.moveSource('inv-inv1-0', R, docs)).toEqual({ sourceType: 'invoice', sourceId: 'invoice#inv1' });
    expect(M.moveSource('isp-d1-2', R, docs)).toEqual({ sourceType: 'dispatch', sourceId: 'invoice#d1' });
    expect(M.moveSource('prn-9', R, docs)).toEqual({ sourceType: 'transfer', sourceId: 'T9' });
    expect(M.moveSource('mv-abc', R, docs)).toEqual({ sourceType: 'legacy', sourceId: 'mv-abc' });
    const m = M.mapMove(fx.data.moves[1]!, R);
    expect(m).toMatchObject({ qty: '-2.0000', value: '-1200.00', direction: 'out', kind: 'sale', price: '600.0000' });
    expect(m.lines).toEqual([{ account: '7000', debit: 1200, credit: 0 }, { account: '6600', debit: 0, credit: 1200 }]);
  });

  it('payroll, VAT period of a close journal, users without plaintext passwords', () => {
    const p = M.mapPayroll(fx.data.payroll[0]!, R);
    expect(p.head).toMatchObject({ month: '2026-01', date: '2026-01-31', status: 'posted', locked: true });
    expect(p.emps[0]!.emp.employeeId).toBe('employee#e1');
    expect(M.vatPeriodOfJournal({ id: 'ddv-2026-Т1', date: '2026-03-31' }, 'quarter')).toEqual({ period: '2026-Т1', periodKind: 'quarter', dateFrom: '2026-01-01', dateTo: '2026-03-31' });
    expect(M.vatPeriodOfJournal({ id: 'x', date: '2026-05-31' }, 'month').period).toBe('2026-05');
    const u = M.mapUser({ id: 'u1', username: 'Ana', name: 'Ана', role: 'acc', firms: ['f1', '*'], salt: 's', hash: 'p2$150000$ab', pw0: 'secret' });
    expect(u).toMatchObject({ username: 'ana', allFirms: true, passwordHash: 'p2$150000$ab', legacySalt: 's', firms: ['f1'] });
    expect(JSON.stringify(u)).not.toContain('secret');
  });

  it('number and date helpers accept what users typed', () => {
    expect([num('1.234,50'), num('1,5'), num('1 200 ден.'), num('12,345'), num(null)]).toEqual([1234.5, 1.5, 1200, 12345, 0]);
    expect([isoDate('05.02.2026'), isoDate('2026-02-30'), isoDate('2026-02-05T10:00:00Z')]).toEqual(['2026-02-05', null, '2026-02-05']);
  });
});
