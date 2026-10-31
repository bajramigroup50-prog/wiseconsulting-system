import { describe, expect, it } from 'vitest';
import { fimpToFirm, isPersonLike, yuscii } from './firmimp';

describe('Excel import: the contact person is the signer (Одговорно лице)', () => {
  it('old 7-bit letters become Š Ć Č Đ Ž', () => {
    expect(yuscii('LEOTRIM [A]IRI')).toBe('LEOTRIM ŠAĆIRI');
    expect(yuscii('REXEP KOVA^I')).toBe('REXEP KOVAČI');
    expect(yuscii('IRSENA TOKOVI]-DEMIROVI]')).toBe('IRSENA TOKOVIĆ-DEMIROVIĆ');
    expect(yuscii('Blerim Aliu')).toBe('Blerim Aliu');
    expect(yuscii('Šaćiri [x]')).toBe('Šaćiri [x]');
  });
  it('a name becomes the signer, a phone or an e-mail does not', () => {
    expect(isPersonLike('TIRON ALILI')).toBe(true);
    expect(isPersonLike('070 123 456')).toBe(false);
    expect(isPersonLike('info@firma.mk')).toBe(false);
    const f = fimpToFirm({ name: 'МЕДИА ДООЕЛ', contact: 'LEOTRIM [A]IRI' } as never);
    expect(f.settings).toMatchObject({ contact: 'LEOTRIM ŠAĆIRI', signer: 'LEOTRIM ŠAĆIRI' });
    expect(fimpToFirm({ name: 'X', contact: '070 111 222' } as never).settings.signer).toBeUndefined();
    expect(fimpToFirm({ name: 'X', contact: 'A B', signer: 'Друг Управител' } as never).settings.signer).toBe('Друг Управител');
  });
});
