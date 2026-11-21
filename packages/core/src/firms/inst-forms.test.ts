import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORMS0, INST_FORM_LINKS, INST_FORMS, fSrcVal, formBg, formVals, type ReqFirm } from './requests';
import { isInstId } from '../office/institutions';

const pub = (p: string) => fileURLToPath(new URL(`../../../../apps/web/public${p}`, import.meta.url));
const firm: ReqFirm = { name: 'АЛФА ДООЕЛ', edb: '4030000000012', embs: '7654321', address: 'ул. 1', city: 'Скопје', phone: '071 204 123', email: 'a@a.mk', signer: 'Петар Петров', signerEmbg: '0101990450011', nkd: '69.20', activity: 'Сметководство' };

describe('official forms of the institutions (wiseconsulting.com.mk › Обрасци)', () => {
  it('every catalog row has a known institution; a fillable one points to a form', () => {
    expect(INST_FORM_LINKS.length).toBeGreaterThan(50);
    for (const l of INST_FORM_LINKS) {
      expect(isInstId(l.inst)).toBe(true);
      if (l.form) expect(INST_FORMS.some((f) => f.id === l.form)).toBe(true);
    }
  });
  it('the forms: unique ids, every page image exists, the fields lie on the page', () => {
    const ids = [...FORMS0, ...INST_FORMS].map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(INST_FORMS.filter((f) => f.inst === 'УЈП').length).toBeGreaterThanOrEqual(8);
    for (const f of INST_FORMS) {
      f.pages!.forEach((pg, i) => {
        expect(existsSync(pub(formBg(f, i)))).toBe(true);
        for (const x of f.fields.filter((y) => (y.p ?? 0) === i)) expect(x.x >= 0 && x.y >= 0 && x.x + x.w <= pg.W + 2 && x.y + x.h <= pg.H + 2).toBe(true);
      });
    }
  });
  it('ДДВ-01 fills the firm, the activity and the signer', () => {
    const f = INST_FORMS.find((x) => x.name.startsWith('ДДВ-01 '))!;
    const V = formVals(f, firm, {}, '2026-11-20');
    const val = (src: string) => f.fields.filter((x) => x.src === src).map((x) => V[x.k]);
    expect(val('f.edb')).toContain('4030000000012');
    expect(val('f.name')).toContain('АЛФА ДООЕЛ');
    expect(val('f.nkd')).toContain('69.20');
    expect(val('f.actname')).toContain('Сметководство');
    expect(val('f.signer')).toContain('Петар Петров');
    expect(val('today')).toContain('20.11.2026');
    expect(fSrcVal('Управител', firm, '2026-11-20')).toBe('Управител');
  });
});

describe('letters to the inspectorates (ДПИ, ДИТ, АХВ…)', () => {
  it('every institution has the usual replies, filled with the firm; nothing left as a raw firm placeholder', async () => {
    const { INST_LETTERS } = await import('./inst-letters');
    const { fillTpl } = await import('./requests');
    for (const i of ['ДПИ', 'ДИТ', 'АХВ', 'МЕ']) expect(INST_LETTERS.filter((l) => l.inst === i).length).toBeGreaterThanOrEqual(5);
    const t = INST_LETTERS.find((l) => l.id === 'l_dpi_otstr')!;
    const out = fillTpl(t.body, firm, { 'Број на актот': '12-34' }, '2026-11-21');
    expect(out).toContain('АЛФА ДООЕЛ, со седиште на ул. 1, Скопје, ЕДБ 4030000000012');
    expect(out).toContain('бр. 12-34');
    expect(out).not.toMatch(/\{[^?]/);
    expect(new Set(INST_LETTERS.map((l) => l.id)).size).toBe(INST_LETTERS.length);
  });
  it('ДИТ „работа во недела“ is a fillable official form', () => {
    const f = INST_FORMS.find((x) => x.id === 'i_dit_nedela')!;
    const V = formVals(f, firm, {}, '2026-11-21');
    expect(V.naziv).toBe('АЛФА ДООЕЛ');
    expect(V.embs).toBe('7654321');
    expect(V.odg).toBe('Петар Петров');
  });
});
