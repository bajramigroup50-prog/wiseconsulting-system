import { describe, expect, it } from 'vitest';
import { boughtByOwnFirm, firmNameKey, isOwnParty, issuedByOwnFirm, ownerCheck } from './sales';

const ME = { edb: '4085025502990', name: 'МЕДИА ПОВЕР ГРОУП ДООЕЛ' };
describe('own firm on a read document', () => {
  it('name without the legal form, Latin or Cyrillic', () => {
    expect(firmNameKey('„МЕДИА ПОВЕР ГРОУП“ ДООЕЛ Скопје')).toBe('МЕДИА ПОВЕР ГРОУП');
    expect(isOwnParty('МЕДИА ПОВЕР ГРОУП ДООЕЛ', '', ME.edb, ME.name)).toBe(true);
    expect(isOwnParty('ФРЕШ ТЕК ДООЕЛ', '', ME.edb, ME.name)).toBe(false);
    // the ЕДБ printed differs from the firm card (a wrong card): the name still decides
    expect(isOwnParty('МЕДИА ПОВЕР ГРОУП ДООЕЛ', 'MK4082018521939', ME.edb, ME.name)).toBe(true);
  });
  it('a sale read with our firm as the buyer (by name) is a purchase; a purchase issued by us is a sale', () => {
    expect(ownerCheck('sale', { buyerName: 'МЕДИА ПОВЕР ГРОУП ДООЕЛ' }, ME.edb, ME.name)).toMatch(/влезна/);
    expect(boughtByOwnFirm({ invoices: [{ buyerName: 'МЕДИА ПОВЕР ГРОУП ДООЕЛ', supplierName: 'ФРЕШ ТЕК ДООЕЛ' }] } as never, ME.edb, ME.name)).toBe(true);
    // a sales read has no supplier: the buyer = our firm is a misread, not yet a purchase
    expect(boughtByOwnFirm({ invoices: [{ buyerName: 'МЕДИА ПОВЕР ГРОУП ДООЕЛ' }] } as never, ME.edb, ME.name)).toBe(false);
    expect(issuedByOwnFirm({ invoices: [{ supplierName: 'МЕДИА ПОВЕР ГРОУП', buyerName: 'ДАУТИ КОМЕРЦ АД' }] } as never, ME.edb, ME.name)).toBe(true);
  });
});
