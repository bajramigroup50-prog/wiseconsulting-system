import { describe, expect, it } from 'vitest';
import {
  firmProfiles, KL_PROF, KL_SEC, klAddRecommended, klAllowedViews, klEntryAllowed, klModuleOff, klSections, profilesAuto,
} from '../office/portal';
import { KL_INSP, klInspDefault, klNoteClean, klNoteHtml } from './klnote';
import { izjavaBlocks, izjavaHtml, izjavaParagraphs } from './izjava';

describe('client portal sections (legacy KL_SEC with runtime pushes)', () => {
  it('has the final legacy lists', () => {
    expect(KL_PROF.map((x) => x[0])).toEqual(['auto', 'hotel', 'wholesale', 'retail', 'construct', 'prod', 'service', 'rent', 'med', 'rest', 'transport', 'travel']);
    expect(KL_SEC[1]![0]).toBe('dash');
    expect(KL_SEC.map((s) => s[0])).toContain('turI');
    expect(new Set(KL_SEC.map((s) => s[0])).size).toBe(KL_SEC.length);
  });
  it('hides sections of a module that is off', () => {
    const s = KL_SEC.find((x) => x[0] === 'hot')!;
    expect(klModuleOff(s, [])).toBe(true);
    expect(klModuleOff(s, ['hotel'])).toBe(false);
    expect(klModuleOff(s, undefined)).toBe(false);
    const c = { on: { hot: true, izlez: true } };
    expect(klSections(c, []).map((x) => x[0])).toEqual(['docs', 'send', 'izlez', 'kdfi', 'metg']);
    expect(klSections(c, ['hotel']).map((x) => x[0])).toContain('hot');
    expect(klAllowedViews(c, ['hotel'])).toContain('hotel');
    expect(klAllowedViews(c, [])).not.toContain('hotel');
  });
  it('derives profiles from the NKD code unless set by hand (firmProf / profAuto)', () => {
    expect(firmProfiles(null, '47.11 Трговија на мало')).toEqual(['retail']);
    expect(profilesAuto(null)).toBe(true);
    expect(firmProfiles({ prof: [], profSet: true }, '47.11')).toEqual([]);
    expect(profilesAuto({ prof: [], profSet: true })).toBe(false);
    expect(firmProfiles({ prof: ['hotel'] }, '47.11')).toEqual(['hotel']);
  });
  it('switches on recommended, non-base sections whose module is on (klAddRec)', () => {
    const on = klAddRecommended({ on: { izlez: true } }, ['retail'], []);
    expect(on).toMatchObject({ izlez: true, kasa: true, mprod: true, mlager: true });
    expect(on.repl).toBeUndefined(); // module „buy“ off
    expect(on.metg).toBeUndefined(); // base section
    expect(on.loy).toBeUndefined(); // module „loy“ off
    expect(klAddRecommended(null, ['retail'], ['loy']).loy).toBe(true);
  });
  it('client entry permissions (u.kp)', () => {
    expect(klEntryAllowed('invoice', { out: true })).toBe(true);
    expect(klEntryAllowed('sale', { in: true })).toBe(false);
    expect(klEntryAllowed('purchase', { in: true })).toBe(true);
    expect(klEntryAllowed('purchase', null)).toBe(false);
    expect(klEntryAllowed('dossier', null)).toBe(true);
  });
});

describe('store-door notice (klNoteHTML)', () => {
  it('default inspectorates by profile', () => {
    expect(klInspDefault([])).toEqual(['dpi']);
    expect(klInspDefault(['hotel'])).toEqual(['dpi', 'ahv', 'dszi']);
    expect(KL_INSP).toHaveLength(6);
  });
  it('cleans the form', () => {
    expect(klNoteClean({ obj: ' Продавница 1 ', insp: ['dpi', 'x'], sq: true })).toEqual({ obj: 'Продавница 1', hrs: '', ujp: '', ujp2: '', insp: ['dpi'], sq: true });
  });
  it('renders the sticker, inspectorates and firm data', () => {
    const f = { name: 'Пример ДООЕЛ', address: 'ул. 1', city: 'Скопје', edb: '4030000000000', embs: '1234567', activity: '47.11', phone: '070' };
    const H = klNoteHtml({ insp: ['dpi', 'ahv'], obj: 'Маркет <1>', hrs: '08–20', ujp: '0800 33 000' }, f);
    expect(H).toContain('ПОБАРАЈ<br>ФИСКАЛНА<br>СМЕТКА!');
    expect(H).toContain('>198<');
    expect(H).toContain('nepravilnosti@dpi.gov.mk');
    expect(H).toContain('sin@fva.gov.mk');
    expect(H).not.toContain('prijavi@dti.gov.mk');
    expect(H).toContain('Маркет &lt;1&gt;');
    expect(H).toContain('Седиште:</b> ул. 1, Скопје');
    expect(H).toContain('УЈП, бесплатен телефон');
    expect(H).not.toContain('KËRKONI');
    const S = klNoteHtml({ sq: true, ujp2: '199', img: '/api/files/x' }, f);
    expect(S).toContain('<img src="/api/files/x"');
    expect(S).toContain('Firma');
    expect(S).not.toContain('>199<'); // the uploaded sticker replaces the drawn one
  });
});

describe('confidentiality statement (zzIzj)', () => {
  it('fills the person and office', () => {
    const D = izjavaBlocks({ name: 'Ана Петровска', pos: 'Сметководител' }, { name: 'WISE CONSULTING', city: 'Тетово' }, '2026-10-10');
    const H = izjavaHtml(D);
    expect(H).toContain('Јас, долупотпишаниот/ата Ана Петровска, ЕМБГ _____________');
    expect(H).toContain('вработен/а во WISE CONSULTING на работно место Сметководител');
    expect(H).toContain('Тетово, 10.10.2026 година');
    expect(H).toContain('Изјавил/а');
    expect(izjavaParagraphs(D).flat()).toContain('Ана Петровска');
  });
});
