import { describe, expect, it } from 'vitest';
import { ARCH_CATEGORIES, archCategory, archCategoryKeep, archKeepLabel, archSignOf, delovodnik, type ArchRow } from './archive';
import { ISO_DOC, isoStarterDocs, isoStarters, isoKind, type IsoRow } from './iso';
import { ISO_FORMS, archListText } from './iso-docs';
import { isoReadiness } from './iso-ready';
import { ISO_REGISTRY, isoRegistry, type RegCtx, type RegFacts } from './iso-registry';
import { soaMerge } from './iso-soa';

const row = (p: Partial<IsoRow> & Pick<IsoRow, 'id' | 'kind'>): IsoRow => ({ no: 1, year: 2026, title: p.id, status: 'open', due: null, created: '2026-01-10T08:00:00Z', closed: null, data: {}, ...p });
const facts: RegFacts = { users: { active: 2 }, employees: [{ name: 'Ана', lek: '2026-01-01', bzr: '2026-01-01' }], aml: { clients: 3, withFile: 3, overdue: 0 }, clients: 3, clientContracts: 2, gdpr: { dpa: 3, activities: 6, requests: { late: 0 }, breaches: { late: 0 } }, files: { total: 10, hashed: 10 }, auditLast: '2026-10-19' };
const ctx = (R: IsoRow[], f: Partial<RegFacts> = {}): RegCtx => ({ R, soa: soaMerge(new Map()), staff: [], facts: { ...facts, ...f }, year: 2026, today: '2026-10-20' });

describe('archive categories and the деловодник', () => {
  it('unique signs, each with a keeping period; documents get their sign and „чувај до“; numbering unchanged', () => {
    expect(new Set(ARCH_CATEGORIES.map((c) => c.sign)).size).toBe(ARCH_CATEGORIES.length);
    expect(archSignOf('Излезна фактура')).toBe('03-03');
    expect(archSignOf('Непознато')).toBe('04-03');
    expect(archCategoryKeep('03-03', '2026-05-01')).toBe('2031-12-31');
    expect(archCategoryKeep('03-02', '2026-05-01')).toBeNull();
    expect(archKeepLabel(archCategory('04-01')!)).toBe('10 години по престанок');
    const R: ArchRow[] = [{ key: 'invoice:a', date: '2026-01-10', kind: 'Излезна фактура', no: '1', pn: '', amt: null, files: [] }, { key: 'dossier_doc:x', date: '2026-02-01', kind: 'Решение', no: '', pn: '', amt: null, files: [] }];
    expect(delovodnik(R, 2026).map((r) => [r.regNo, r.sign, r.keepUntil])).toEqual([['02-1/26', '03-03', '2031-12-31'], ['03-1/26', '01-01', null]]);
    expect(archListText('WISE')).toContain('03-01 Деловни книги');
  });
});

describe('document coding and forms', () => {
  it('ПОЛ / ПОС marks are unique; every form has a procedure that exists', () => {
    const D = isoStarterDocs('WISE');
    expect(D.every((d) => /^(ПОЛ|ПОС)-\d\d$/.test(d.docNo))).toBe(true);
    expect(new Set(D.map((d) => d.docNo)).size).toBe(D.length);
    for (const k of [ISO_DOC.archive, ISO_DOC.edocs, ISO_DOC.archList]) expect(D.some((d) => d.docNo === k)).toBe(true);
    expect(ISO_FORMS.every((f) => /^ОБР-\d\d$/.test(f.code) && D.some((d) => d.docNo === f.proc))).toBe(true);
    expect(new Set(ISO_FORMS.map((f) => f.code)).size).toBe(ISO_FORMS.length);
    for (const k of ['legal', 'asset'] as const) {
      const keys = new Set(isoKind(k)!.fields.map((f) => f.k));
      for (const s of isoStarters(k, '')) expect(Object.keys(s.data).filter((x) => !keys.has(x))).toEqual([]);
    }
  });
});

describe('master register of mandatory records', () => {
  it('unique ids and codes, each with a sign of the category list', () => {
    expect(new Set(ISO_REGISTRY.map((r) => r.id)).size).toBe(ISO_REGISTRY.length);
    expect(new Set(ISO_REGISTRY.map((r) => r.code)).size).toBe(ISO_REGISTRY.length);
    expect(ISO_REGISTRY.every((r) => archCategory(r.sign))).toBe(true);
    for (const id of ['worktime', 'bzr-statement', 'aml', 'delovodnik', 'archbook', 'destroy', 'licence', 'soa', 'assets', 'legal']) expect(ISO_REGISTRY.some((r) => r.id === id)).toBe(true);
  });
  it('computed rows from the program; manual rows from the confirmation, out of date after their interval', () => {
    const L0 = isoRegistry(ctx([]));
    const g = (L: ReturnType<typeof isoRegistry>, id: string) => L.find((r) => r.id === id)!;
    expect(g(L0, 'aml')).toMatchObject({ state: 'ok', manual: false });
    expect(g(L0, 'contracts')).toMatchObject({ state: 'old', note: '2 / 3 клиенти со договор' });
    expect(g(L0, 'worktime')).toMatchObject({ state: 'miss', manual: true, form: 'ОБР-01', retention: '5 години' });
    expect(g(L0, 'scope').state).toBe('miss');
    const R = [row({ id: 'e1', kind: 'evid', title: 'worktime', data: { lastOn: '2026-10-01' } }), row({ id: 'e2', kind: 'evid', title: 'licence', data: { lastOn: '2025-01-01' } }), row({ id: 'e3', kind: 'evid', title: 'archapproval', data: { lastOn: '2020-01-01' } })];
    const L = isoRegistry(ctx(R));
    expect(g(L, 'worktime')).toMatchObject({ state: 'ok', last: '2026-10-01', evidId: 'e1' });
    expect(g(L, 'licence').state).toBe('old');
    expect(g(L, 'archapproval').state).toBe('ok');
    expect(g(isoRegistry(ctx([], { employees: [{ name: 'Ана', lek: null, bzr: '2026-01-01' }] })), 'bzr-training').state).toBe('miss');
    expect(g(isoRegistry(ctx([], { files: { total: 10, hashed: 9 } })), 'edocs').state).toBe('old');
  });
  it('the legal and archive rows are a section of the readiness checklist', () => {
    const registry = isoRegistry(ctx([]));
    const S = isoReadiness({ R: [], soa: soaMerge(new Map()), staff: [], gdpr: { ...facts.gdpr, statements: 0 }, clients: 3, clientContracts: 2, year: 2026, today: '2026-10-20', registry });
    const law = S.find((s) => s.std === 'law')!;
    expect(law.items.length).toBe(registry.filter((r) => r.std === 'law' || r.std === 'arch').length);
    expect(law.items.find((x) => x.id === 'reg:worktime')).toMatchObject({ state: 'miss', href: '/iso?k=evid#worktime' });
  });
});
