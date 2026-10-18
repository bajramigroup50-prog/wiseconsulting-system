/**
 * ЗДДВ чл. 32-а / exemption notes: reading (AI `vatNote`, free PDF reader, purchase drafts), the `customer32`
 * receivable konto, the invoice print note, and the ДДВ-04 annex per field (sums exactly to fields 08–11).
 */
import { describe, expect, it } from 'vitest';
import { customerAccount, invoiceEntries, type PostingContext } from './posting';
import { ddv04FromResult, ddvFieldDocs, ddvFor } from './vat';
import { notInvoiceMsg } from './sales/scan';
import { ART32_NOTE, NO_VAT_DED_NOTE, NO_VAT_NOTE_MSG, purchaseDraftFromScan, saleDraftFromScan, scanNoVatRule, vatNoteOf } from './sales/scan';
import { JI_EXEMPT_NOTE, jiInvoices, jiRows } from './journal-import';
import { invoicePrintHtml } from './sales/invoice-print';
import { invoiceFromPdf } from './noai/purchase';
import { pdfLines, type PdfItem } from './noai/pdf-lines';

const ctx = (o: Partial<PostingContext['firm']> = {}): PostingContext => ({ firm: { ddv: true, ...o } });

describe('vatNoteOf', () => {
  it.each([
    'Пренесување на даночната обврска согласно член 32-а од ЗДДВ', 'Согласно чл. 32 а од Законот за ДДВ', 'чл.32-а', '32-а ЗДДВ',
    'пренесување на даночна обврска', 'ДДВ пресметува примателот', 'Reverse charge', 'член 32-a (latin a)',
  ])('art. 32-a: %s', (t) => expect(vatNoteOf(t)).toEqual({ kind: 'art32', note: ART32_NOTE }));
  it('exemption with the printed basis', () => {
    expect(vatNoteOf('Фактура бр. 5\nОслободено од ДДВ согласно член 24 од ЗДДВ.\nПотпис')).toEqual({ kind: 'exempt', note: 'Ослободено од ДДВ согласно член 24 од ЗДДВ', exempt: 'ded' });
    expect(vatNoteOf('Промет без право на одбивка')).toMatchObject({ kind: 'exempt', exempt: 'noded' });
    expect(vatNoteOf('Ослободено со право на одбивка')).toMatchObject({ kind: 'exempt', exempt: 'ded' });
    expect(vatNoteOf('Ослободено од ДДВ согласно чл. 23 од ЗДДВ')).toMatchObject({ exempt: 'noded' });
    expect(vatNoteOf('Ослободено од ДДВ без право на одбивка согласно член 24')).toMatchObject({ exempt: 'noded' }); // the explicit right wins
    expect(vatNoteOf('Испорака во ТИРЗ – ослободено од ДДВ')).toMatchObject({ exempt: 'ded' });
    expect(vatNoteOf('Извоз – ослободено од ДДВ')).toMatchObject({ exempt: 'ded' });
    // unclear: no article / right named, or both
    expect(vatNoteOf('согласно чл. 30 од ЗДДВ')).toMatchObject({ kind: 'exempt', exempt: null });
    expect(vatNoteOf('Ослободено од ДДВ')).toMatchObject({ kind: 'exempt', exempt: null });
    expect(vatNoteOf('чл. 23 и чл. 24 од ЗДДВ')).toMatchObject({ exempt: null });
  });
  it('nothing / unrelated text', () => {
    expect(vatNoteOf('')).toBeNull();
    expect(vatNoteOf('член 320 од законот за облигации')).toBeNull();
    expect(vatNoteOf('Фактура 32-ав')).toBeNull();
  });
});

describe('scan drafts', () => {
  const o = { partners: [], items: [], revKonto: '7400', today: '2026-07-01', nextNumber: '1/2026' };
  it('sale: a no-VAT read with the 32-а note → art32 at 18 %, total = base (prices not divided)', () => {
    const d = saleDraftFromScan({ number: 'A', lines: [{ name: 'Услуга', qty: 2, price: 500, amount: 1000, rate: 0 }], total: 1000, vatNote: 'ДДВ пресметува примателот' }, o);
    expect([d.art32, d.items[0]!.rate, d.items[0]!.price, d.vatCheck]).toEqual([true, 18, 500, undefined]);
  });
  it('sale: lines at 18 % but a recapitulation without VAT and no note → 0 %, flagged', () => {
    const d = saleDraftFromScan({ number: 'B', lines: [{ name: 'Услуга', qty: 1, price: 1000, amount: 1000, rate: 18 }], groups: [{ rate: 18, base: 1000, vat: 0 }], total: 1000 }, o);
    expect([d.items[0]!.rate, d.items[0]!.price, d.vatCheck]).toEqual([0, 1000, true]);
  });
  it('sale: the firm rule „0 % = чл. 24“ (default) – a no-VAT read without a note is exempt with the right to deduct, ready', () => {
    expect([scanNoVatRule({}), scanNoVatRule(null), scanNoVatRule({ scanNoVat: 'check' })]).toEqual(['ded', 'ded', 'check']);
    const d = saleDraftFromScan({ number: 'E', lines: [{ name: 'Услуга', qty: 1, price: 25000, amount: 25000, rate: 0 }], groups: [{ rate: 0, base: 25000, vat: 0 }], total: 25000 }, { ...o, noVat: 'ded' });
    expect([d.art32, d.items[0]!.rate, d.vatExempt, d.vatNote, d.vatCheck]).toEqual([false, 0, 'ded', NO_VAT_DED_NOTE, undefined]);
    // a printed „без право на одбивка“ note still wins over the rule
    const n = saleDraftFromScan({ number: 'F', lines: [{ name: 'Услуга', qty: 1, price: 100, amount: 100, rate: 0 }], total: 100, vatNote: 'Ослободено од ДДВ без право на одбивка' }, { ...o, noVat: 'ded' });
    expect(n.vatExempt).toBe('noded');
    // a 32-а note still wins
    expect(saleDraftFromScan({ number: 'G', lines: [{ name: 'Услуга', qty: 1, price: 100, amount: 100, rate: 0 }], total: 100, vatNote: 'член 32-а' }, { ...o, noVat: 'ded' }).art32).toBe(true);
  });
  it('sale: „ДДВ не е пресметан согласно член 15 … јавен интерес … Коридор 8“ is exempt with the right to deduct (field 08)', () => {
    const d = saleDraftFromScan({ number: 'H', lines: [{ name: 'Дезинсекција', qty: 1, price: 30000, amount: 30000, rate: 0 }], total: 30000,
      vatNote: 'ДДВ не е пресметан согласно член 15 од Законот за утврдување на јавен интерес и номинирање на стратешки партнер за проектот Коридор 8 и Коридорот 10Д' }, o);
    expect([d.vatExempt, d.vatCheck]).toEqual(['ded', undefined]);
  });
  it('sale: a normal 18 % invoice is untouched', () => {
    const d = saleDraftFromScan({ number: 'C', lines: [{ name: 'Услуга', qty: 1, price: 1000, amount: 1000, rate: 18 }], groups: [{ rate: 18, base: 1000, vat: 180 }], total: 1180 }, o);
    expect([d.art32, d.items[0]!.rate, d.vatCheck, d.vatNote]).toEqual([false, 18, undefined, undefined]);
  });
  it('purchase: a received invoice with the note is art. 32-a at 18 %, no VAT', () => {
    const d = purchaseDraftFromScan({ number: 'D', groups: [{ rate: 0, base: 500, vat: 0 }], total: 500, vatNote: 'Пренесување на даночна обврска чл. 32-а' },
      { partners: [], items: [], accounts: { goods: '6600', material: '3100', other: '4000' }, today: '2026-07-01' });
    expect([d.art32, d.groups]).toEqual([true, [{ rate: 18, base: 500, vat: 0, konto: '4000' }]]);
  });
});

describe('free PDF reader', () => {
  const page = (rows: [number, string][][]): PdfItem[] => rows.flatMap((r, i) => r.map(([x, s]) => ({ page: 1, x, y: 800 - i * 14, w: s.length * 5, h: 9, s })));
  it('the note makes the invoice art. 32-a: base = total, no VAT', () => {
    const L = pdfLines(page([
      [[50, 'ТРУЛИ НОЛЕН НМ ДООЕЛ, ЕДБ: MK4030000000001']],
      [[50, 'Купувач: ИНВЕСТИТОР ДОО, ЕДБ 4030999000111']],
      [[50, 'ФАКТУРА бр. CLK-202607-1031']],
      [[50, 'Датум на фактура: 05.07.2026']],
      [[50, 'Пренесување на даночната обврска согласно член 32-а од ЗДДВ']],
      [[50, 'Вкупно за плаќање:'], [300, '5.000,00']],
    ]));
    const r = invoiceFromPdf(L, { ownEdb: '4030000000001', kind: 'sale' })!;
    expect([r.art32, r.vatNote, r.groups, r.total]).toEqual([true, ART32_NOTE, [{ rate: 18, base: 5000, vat: 0, kind: 'other' }], 5000]);
  });
});

describe('customer32 / customerExempt receivable', () => {
  const inv = { date: '2026-07-01', partner: 'p', art32: true, items: [{ qty: 1, price: 1000, rate: 18, konto: '7400' }] };
  it('art. 32-a → customer32 when set, else 1200; exempt чл. 24 → customerExempt, else 1200009 from the chart, else 1200', () => {
    // defaults: art. 32-a → customer (1200); exempt чл. 24 → 1200009 when the chart has it
    expect(customerAccount(ctx({ customerExemptAuto: '1200009' }), true)).toBe('1200');
    expect(customerAccount(ctx({ customerExemptAuto: '1200009' }), false, true)).toBe('1200009');
    expect(customerAccount(ctx({ customerExemptAuto: '1200009' }), false)).toBe('1200');
    expect(customerAccount(ctx(), false, true)).toBe('1200');
    expect(customerAccount(ctx({ customerExemptAuto: '1200009', sch: { customerExempt: '-' } }), false, true)).toBe('1200');
    expect(customerAccount(ctx(), true)).toBe('1200');
    expect(customerAccount(ctx({ sch: { customer32: '1209' } }), true)).toBe('1209');
    const L = invoiceEntries(inv, ctx({ sch: { customer32: '1200009' } }));
    // revenue stays as now (the line konto), no output VAT line
    expect(L.map((l) => [l.account, l.debit, l.credit])).toEqual([['1200009', 1000, 0], ['7400', 0, 1000]]);
    expect(L[0]).toMatchObject({ account: '1200009', debit: 1000, partnerId: 'p' });
    expect(L.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
    expect(invoiceEntries(inv, ctx())[0]!.account).toBe('1200');
  });
  it('„Извозна“ (export) → the foreign-customer konto 1210 (customerFx); a domestic invoice stays on 1200; „-“ keeps 1200', () => {
    const ex = { date: '2026-08-18', partner: 'p', export: true, items: [{ qty: 246, price: 35, rate: 0, konto: '7410' }] };
    expect(invoiceEntries(ex, ctx())[0]).toMatchObject({ account: '1210', debit: 8610, partnerId: 'p' });
    expect(invoiceEntries({ ...ex, export: false, items: [{ qty: 1, price: 100, rate: 18, konto: '7400' }] }, ctx())[0]!.account).toBe('1200');
    expect(invoiceEntries(ex, ctx({ sch: { customerFx: '-' } }))[0]!.account).toBe('1200');
    expect(invoiceEntries(ex, ctx({ sch: { customerFx: '1219' } }))[0]!.account).toBe('1219');
  });
});

describe('invoice print', () => {
  const base = {
    firm: { name: 'Ф', edb: '1', vatRegistered: true, settings: {} }, partner: { name: 'К' }, kind: 'invoice' as const,
    lines: [{ name: 'Услуга', qty: 1, price: 100, disc: 0, rate: 18 }],
  };
  it('prints the art. 32-a note, or the legal basis of an exempt invoice', () => {
    const a = invoicePrintHtml({ ...base, doc: { kind: 'invoice', number: '1', date: '2026-07-01', art32: true, currency: 'MKD', fx: 1 } } as never);
    expect(a).toContain(ART32_NOTE);
    const e = invoicePrintHtml({ ...base, lines: [{ ...base.lines[0], rate: 0 }], doc: { kind: 'invoice', number: '2', date: '2026-07-01', currency: 'MKD', fx: 1, data: { vatNote: 'Ослободено од ДДВ согласно член 24 од ЗДДВ' } } } as never);
    expect(e).toContain('Ослободено од ДДВ согласно член 24 од ЗДДВ');
  });
});

describe('ДДВ-04 annex per field', () => {
  const it0 = (price: number, rate = 0) => [{ qty: 1, price, rate, konto: '7400' }];
  const docs = {
    invoices: [
      { id: 'a', number: '1', date: '2026-07-01', partner: 'p', items: it0(100.4), vatNote: 'чл. 24' },
      { id: 'b', number: '2', date: '2026-07-02', partner: 'p', items: it0(200.4) },
      { id: 'c', number: '3', date: '2026-07-03', partner: 'p', items: it0(300.3), zeroKind: 'exemptNoDed' as const },
      { id: 'c2', number: '3a', date: '2026-07-03', partner: 'p', items: it0(50.1), vatExempt: 'noded' as const, vatNote: 'чл. 23 ЗДДВ' },
      { id: 'c3', number: '3b', date: '2026-07-03', partner: 'p', items: it0(0.05), vatExempt: 'ded' as const },
      { id: 'd', number: '4', date: '2026-07-04', partner: 'p', items: it0(400.6), zeroKind: 'nonResident' as const },
      { id: 'e', number: '5', date: '2026-07-05', partner: 'p', art32: true, items: it0(1000.45, 18) },
      { id: 'f', number: '6', date: '2026-07-06', partner: 'p', art32: true, credit: true, items: it0(100.2, 18) },
      { id: 'g', number: '7', date: '2026-07-07', partner: 'p', items: [...it0(50.25), ...it0(1000, 18)] },
      { id: 'h', number: '8', date: '2026-10-01', partner: 'p', items: it0(999) },
    ],
    sales: [{ id: 's', date: '2026-07-10', number: 'Z1', groups: [{ rate: 0, base: 10.1, vat: 0 }] }],
  };
  it('each section sums exactly to its field, the rounding shown, credit notes negative', () => {
    const c = ctx();
    const F = ddv04FromResult(ddvFor(docs, '2026-Т3', 'quarter', c));
    const S = ddvFieldDocs(docs, '2026-Т3', 'quarter', c, { partners: { p: { name: 'Купувач', edb: 'MK1' } } });
    const by = Object.fromEntries(S.map((s) => [s.field, s]));
    expect(Object.keys(by).sort()).toEqual(['08', '09', '10', '11']);
    for (const k of ['08', '09', '10', '11'] as const) {
      expect(by[k]!.value).toBe(F[k]);
      expect(Math.round(by[k]!.rows.reduce((s, r) => s + r.base * 100, 0))).toBe(Math.round(by[k]!.sum * 100));
      expect(by[k]!.rounding).toBe(Math.round((F[k]! - by[k]!.sum) * 100) / 100);
    }
    expect(by['08']!.sum).toBe(361.2); // 100.40 + 200.40 + 0.05 (ded) + 50.25 + Z 10.10
    expect([F['08'], by['08']!.rounding]).toEqual([361, -0.2]);
    expect(by['08']!.rows.map((r) => [r.number, r.basis])).toEqual([['1', 'чл. 24'], ['2', 'ослободено со право на одбивка'], ['3b', 'ослободено со право на одбивка'], ['7', 'ослободено со право на одбивка'], ['Z1', 'ослободено со право на одбивка']]);
    expect(by['09']!.rows.map((r) => [r.number, r.base, r.basis])).toEqual([['3', 300.3, 'ослободено без право на одбивка'], ['3a', 50.1, 'чл. 23 ЗДДВ']]);
    expect(by['11']!.rows.map((r) => [r.kind, r.base])).toEqual([['invoice', 1000.45], ['credit', -100.2]]);
    expect([by['11']!.sum, F['11']]).toEqual([900.25, 900]);
    expect([F['09'], F['10']]).toEqual([350, 401]); // 300.30 + 50.10 → 350
    expect(by['09']!.rows[0]).toMatchObject({ name: 'Купувач', edb: 'MK1', base: 300.3 });
  });
});

describe('journal import: groups without VAT', () => {
  it('1200009 → exempt чл. 24 (ded); 1200 with a clear exemption note → its kind; 1200 without a note → refused „провери“', () => {
    const { rows } = jiRows([
      { date: '2026-07-01', desc: 'A-1', k: '1200009', d: 1000, pcode: '1' }, { date: '2026-07-01', desc: 'A-1', k: '7400', p: 1000 },
      { date: '2026-07-02', desc: 'A-2', k: '1200', d: 500, pcode: '1' }, { date: '2026-07-02', desc: 'A-2', k: '7400', p: 500 },
      { date: '2026-07-03', doc: 'A-3', desc: 'без право на одбивка, чл. 23', k: '1200', d: 300, pcode: '1' }, { date: '2026-07-03', doc: 'A-3', desc: 'Услуга', k: '7400', p: 300 },
    ]);
    const X = jiInvoices(rows);
    expect(X.inv.map((v) => [v.no, v.vatExempt, v.vatNote])).toEqual([['A-1', 'ded', JI_EXEMPT_NOTE], ['A-3', 'noded', 'без право на одбивка, чл. 23']]);
    expect(X.refused).toEqual([expect.objectContaining({ no: 'A-2', why: NO_VAT_NOTE_MSG })]);
  });
});

describe('„испратница“ with VAT', () => {
  it('a delivery note with a VAT recapitulation and an amount is an invoice; without VAT it is not', () => {
    expect(notInvoiceMsg({ docType: 'delivery_note', total: 15826, groups: [{ rate: 18, base: 13411.53, vat: 2414.07 }] })).toBe('');
    expect(notInvoiceMsg({ docType: 'delivery_note', total: 0, groups: [] })).toBe('испратница – не се книжи');
    expect(notInvoiceMsg({ docType: 'proforma', total: 100, groups: [{ rate: 18, base: 100, vat: 18 }] })).toBe('профактура – не се книжи');
  });
});
