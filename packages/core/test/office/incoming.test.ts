import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { acceptsFile, bankMatch, detectIncoming, fileFormatLabel, incomingFromCapture, incomingRoute } from '../../src/office/incoming';

const fx = (n: string) => new Uint8Array(readFileSync(fileURLToPath(new URL('../golden/bank/fixtures/' + n, import.meta.url))));
const enc = (s: string) => new TextEncoder().encode(s);
const OWN = '4030000000001';

describe('incoming type detection (free first)', () => {
  it('Halk XML statement', () => {
    const d = detectIncoming({ name: 'izvod.xml', mime: 'text/xml' }, fx('halk-mkd.xml'));
    expect(d).toMatchObject({ kind: 'bank', how: 'bank', format: 'halk-xml', needsAi: false });
    expect(d.statements![0]!.account).toContain('270000012345678');
  });
  it('camt.053 statement', () => {
    const d = detectIncoming({ name: 'stmt.xml', mime: 'application/xml' }, fx('camt053.xml'));
    expect(d).toMatchObject({ kind: 'bank', format: 'camt.053' });
    expect(d.statements![0]!.iban ?? d.statements![0]!.account).toMatch(/300000000123456/);
  });
  it('MT940 statement', () => {
    const d = detectIncoming({ name: 'izvod.sta', mime: '' }, fx('mt940-single.sta'));
    expect(d).toMatchObject({ kind: 'bank', format: 'mt940' });
    expect(d.statements!.length).toBeGreaterThan(0);
  });
  it('a text purchase PDF: the issuer ЕДБ is not the own one → received invoice', () => {
    const text = 'ФАКТУРА бр. 15/2026\nИздавач: Алфа ДОО, ЕДБ 4030999999999\nКупувач: Наша фирма, ЕДБ ' + OWN + '\nВкупно 11.800,00';
    expect(detectIncoming({ name: 'f.pdf', mime: 'application/pdf' }, enc('%PDF'), { text, ownEdb: OWN })).toMatchObject({ kind: 'in', how: 'text', needsAi: false });
    expect(detectIncoming({ name: 'f.pdf', mime: 'application/pdf' }, enc('%PDF'), { text: text.replace('4030999999999', OWN), ownEdb: OWN }).kind).toBe('out');
  });
  it('decisions, contracts and МПИН by their words', () => {
    expect(detectIncoming({ name: 'r.pdf', mime: 'application/pdf' }, enc(''), { text: 'РЕШЕНИЕ за упис на ДДВ обврзник' }).kind).toBe('decision');
    expect(detectIncoming({ name: 'd.docx', mime: '' }, enc(''), { text: 'ДОГОВОР за закуп на деловен простор' }).kind).toBe('contract');
    expect(detectIncoming({ name: 'm.pdf', mime: 'application/pdf' }, enc(''), { text: 'Пресметка на плата – МПИН за 09.2026' }).kind).toBe('mpin');
  });
  it('an image needs AI; a scanned PDF too; an unknown file is unknown without AI', () => {
    expect(detectIncoming({ name: 'IMG_1.jpg', mime: 'image/jpeg' }, enc('\xff\xd8'))).toMatchObject({ kind: 'unknown', needsAi: true, how: 'format' });
    expect(detectIncoming({ name: 'scan.pdf', mime: 'application/pdf' }, enc('%PDF'), { text: '' })).toMatchObject({ kind: 'unknown', needsAi: true });
    expect(detectIncoming({ name: 'x.bin', mime: 'application/octet-stream' }, enc('\x00\x01'))).toMatchObject({ kind: 'unknown', needsAi: false });
  });
  it('UBL e-invoice by the XML root', () => {
    const x = `<?xml version="1.0"?><Invoice xmlns="urn:oasis"><cac:AccountingSupplierParty><cbc:ID>4030999999999</cbc:ID></cac:AccountingSupplierParty></Invoice>`;
    expect(detectIncoming({ name: 'e.xml', mime: 'text/xml' }, enc(x), { ownEdb: OWN })).toMatchObject({ kind: 'in', how: 'xml' });
    expect(detectIncoming({ name: 'o.xml', mime: 'text/xml' }, enc('<Narachka><a/></Narachka>')).what).toBe('XML (Narachka)');
  });
  it('labels, accept and routes', () => {
    expect(fileFormatLabel({ name: 'a.300', mime: '' })).toBe('КБ');
    expect(acceptsFile('.pdf,image/*', { name: 'x.JPG', mime: 'image/jpeg' })).toBe(true);
    expect(acceptsFile('.pdf,image/*', { name: 'x.xml', mime: 'text/xml' })).toBe(false);
    expect(incomingRoute('in')).toEqual({ route: 'purchase' });
    expect(incomingRoute('unknown')).toBeNull();
    expect(incomingFromCapture('bank')).toBe('bank');
  });
});

describe('bank statement → firm by IBAN', () => {
  const st = [{ account: '270000012345678', iban: 'MK07270000012345678', currency: 'MKD' }];
  const A = { id: 'A', name: 'Фирма А', accounts: [{ id: 'a1', account: '270-0000123456-78', iban: null }] };
  const B = { id: 'B', name: 'Фирма Б', accounts: [{ id: 'b1', account: '300000000999999', iban: null }] };
  it('the inbox firm owns the account → import', () => expect(bankMatch(st, 'A', [A, B])).toEqual({ mode: 'import', firmId: 'A', accountId: 'a1' }));
  it('another accessible firm → propose only', () => expect(bankMatch(st, 'B', [A, B])).toEqual({ mode: 'propose', firms: [{ id: 'A', name: 'Фирма А' }] }));
  it('office-wide upload → propose', () => expect(bankMatch(st, null, [A, B]).mode).toBe('propose'));
  it('no firm has it → wait', () => expect(bankMatch(st, 'B', [B])).toEqual({ mode: 'wait' }));
});
