import { describe, expect, it } from 'vitest';
import { applyInvoiceTranslations, localizeInvoiceHtml } from './invoice-i18n';
import { invoicePrintHtml } from './invoice-print';

const input = {
  kind: 'invoice' as const,
  doc: { kind: 'invoice', number: '12/2026', date: '2026-11-10', due: '2026-11-25', currency: 'MKD', fx: 1 },
  firm: { name: 'БАЈРАМИ ГРОУП ДООЕЛ', address: 'ул. Илинден 5', city: 'Скопје', edb: '4030000000000', embs: '1234567', vatRegistered: true, settings: { bank: '300000000000000', qr: false } },
  partner: { name: 'Купувач Тест ДООЕЛ', address: 'ул. Партизанска 1', city: 'Битола', edb: '4002000000000' },
  lines: [{ name: 'Сметководствени услуги', qty: 1, price: 1000, disc: 0, rate: 18, unit: 'ком' }],
};

describe('invoice EN / DE', () => {
  const html = invoicePrintHtml(input);
  const keep = [input.firm.name, input.firm.address, input.firm.city, input.partner.name, input.partner.address, input.partner.city];

  it('translates the fixed labels and leaves names for nobody', () => {
    const r = localizeInvoiceHtml(html, 'EN', keep);
    expect(r.html).toContain('INVOICE');
    expect(r.html).toContain('Payment due');
    expect(r.html).toContain('Amount excl. VAT');
    expect(r.html).toContain('AMOUNT DUE');
    expect(r.html).toContain('БАЈРАМИ ГРОУП ДООЕЛ');
    expect(r.html).toContain('Купувач Тест ДООЕЛ');
    expect(r.html).not.toContain('Рок на плаќање');
    // the item name and the amount in words go to DeepL, the names do not
    expect(r.rest).toContain('Сметководствени услуги');
    expect(r.rest.some((x) => /илјада/i.test(x))).toBe(true);
    expect(r.rest).not.toContain('Купувач Тест ДООЕЛ');
    expect(r.rest).not.toContain('Скопје');
  });

  it('German labels and the DeepL pass', () => {
    const r = localizeInvoiceHtml(html, 'DE', keep);
    expect(r.html).toContain('RECHNUNG');
    expect(r.html).toContain('Zahlungsziel');
    const out = applyInvoiceTranslations(r.html, new Map(r.rest.map((x) => [x, x === 'Сметководствени услуги' ? 'Buchhaltungsleistungen' : 'X'])));
    expect(out).toContain('Buchhaltungsleistungen');
    expect(out).not.toContain('Сметководствени услуги');
    expect(out).toContain('style=');
  });
});
