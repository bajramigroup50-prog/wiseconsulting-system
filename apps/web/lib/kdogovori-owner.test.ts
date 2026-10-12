import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { klAllowedViews, klSections, KL_SEC } from '@wise/core/office';
import { NAV, OWNER_VIEWS, navFlat, withoutViews } from './nav';
import { routeVerdict } from './route-guard';
import { htmlDocx, htmlParagraphs, docxText } from './docx';

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const ids = (G: typeof NAV) => G.flatMap(([, L]) => navFlat(L).map(([id]) => id));

describe('✍ Договор за сметководствени услуги — office owner only', () => {
  it('is in the menu only for the owner', () => {
    expect(OWNER_VIEWS).toContain('kdogovori');
    expect(ids(NAV)).toContain('kdogovori');
    expect(ids(withoutViews(NAV, OWNER_VIEWS))).not.toContain('kdogovori');
  });

  it('never in the client portal (menu, allowed views, route guard)', () => {
    expect(KL_SEC.some((s) => s[3] === 'kdogovori')).toBe(false);
    const all = klAllowedViews({ on: Object.fromEntries(KL_SEC.map((s) => [s[0], true])) });
    expect(all).not.toContain('kdogovori');
    expect(routeVerdict('klient', '/kdogovori', all)).toBe('/klHome');
    expect(src('lib/kl-nav.ts')).not.toMatch(/'kdogovori'/);
    expect(src('lib/kl-views.ts')).not.toMatch(/'kdogovori'/);
    expect(src('app/(app)/klHome/page.tsx')).not.toMatch(/kdogovori/);
  });

  it('every server action, the page, the print view and the Word route check the owner', () => {
    const A = src('app/(app)/kdogovori/actions.ts');
    const fns = [...A.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)];
    expect(fns.map((m) => m[1]).sort()).toEqual(['clientSign', 'contractToDossier', 'deleteContract', 'endContract', 'mailContract', 'officeSign', 'saveContract', 'saveOffice', 'setOfficeFirm', 'syncRecurring', 'uploadSignedCopy']);
    for (const [, name, body] of fns) expect(body, name).toMatch(/kdOwnerAction\(\)|ownerCtx\(/);
    expect(A).toMatch(/async function ownerCtx[\s\S]*?kdOwnerAction\(\)/);
    expect(A).not.toMatch(/officeAction\(|currentFirm\(/);
    expect(src('app/(app)/kdogovori/page.tsx')).toMatch(/await kdOwnerUser\(\)/);
    expect(src('app/(print)/kdogovori/pecati/page.tsx')).toMatch(/if \(!\(await kdOwnerUser\(\)\)\) notFound\(\)/);
    expect(src('app/api/office/tpl/own/route.ts')).toMatch(/src\.t === 'kd'[\s\S]*?kdOwnerUser\(\)/);
    expect(src('app/(app)/kdogovori/lib.ts')).toMatch(/isOfficeOwner\(u\)/);
  });
});

describe('✍ Договори за вработување in the client portal', () => {
  it('is a section the office switches on (off by default)', () => {
    const s = KL_SEC.find((x) => x[0] === 'vdog')!;
    expect(s[3]).toBe('klDogovori');
    expect(klSections({}).map((x) => x[0])).not.toContain('vdog');
    expect(klAllowedViews({})).not.toContain('klDogovori');
    expect(klAllowedViews({ on: { vdog: true } })).toContain('klDogovori');
  });
  it('the portal page and print route use the section guard', () => {
    expect(src('app/(app)/klDogovori/page.tsx')).toMatch(/klDogCtx\(\)/);
    expect(src('app/(app)/klDogovori/[id]/route.ts')).toMatch(/klDogCtx\(\)/);
    expect(src('app/(app)/klDogovori/guard.ts')).toMatch(/hrOfficeLocked/);
  });
});

describe('program documents as Word (htmlDocx)', () => {
  const H = `<div style="font-family:serif"><p>Врз основа на Законот, се склучи:</p><h1 style="text-align:center">ДОГОВОР ЗА ВРАБОТУВАЊЕ</h1><p style="text-align:center"><b>Член 1</b></p><p style="text-align:justify">Работникот <b>Петар</b> &amp; друго<br>втор ред</p><img src="x"></div>`;
  it('splits paragraphs, keeps bold and centering', () => {
    const P = htmlParagraphs(H);
    expect(P.map((p) => p.runs.map((r) => r[0]).join(''))).toEqual(['Врз основа на Законот, се склучи:', 'ДОГОВОР ЗА ВРАБОТУВАЊЕ', 'Член 1', 'Работникот Петар & друго', 'втор ред']);
    expect(P[1]).toMatchObject({ center: true, runs: [['ДОГОВОР ЗА ВРАБОТУВАЊЕ', true]] });
    expect(P[3]!.runs).toEqual([['Работникот ', false], ['Петар', true], [' & друго', false]]);
  });
  it('builds a valid .docx with the text', () => {
    const t = docxText(htmlDocx(H));
    expect(t).toContain('ДОГОВОР ЗА ВРАБОТУВАЊЕ');
    expect(t).toContain('Петар & друго'.replace('&', '&amp;'));
  });
});
