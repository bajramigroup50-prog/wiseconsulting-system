import { describe, expect, it } from 'vitest';
import { ISO_DOC, isoCloseCheck, isoKind, isoStarterDocs, isoStarters, type IsoRow } from './iso';
import { isoReadiness, type ReadyCtx } from './iso-ready';
import { ISO_ANNEX_A, soaMerge, soaSummary } from './iso-soa';
import { ackMissing, ackString, isoContractArticles, policiesInForce, staffStatus } from './iso-staff';

const row = (p: Partial<IsoRow> & Pick<IsoRow, 'id' | 'kind'>): IsoRow => ({ no: 1, year: 2026, title: p.id, status: 'open', due: null, created: '2026-01-10T08:00:00Z', closed: null, data: {}, ...p });

describe('Statement of Applicability', () => {
  it('93 unique controls of ISO/IEC 27001:2022 – 37 / 8 / 14 / 34, each with a justification', () => {
    expect(ISO_ANNEX_A.length).toBe(93);
    expect(new Set(ISO_ANNEX_A.map((c) => c.id)).size).toBe(93);
    expect(['org', 'people', 'physical', 'tech'].map((t) => ISO_ANNEX_A.filter((c) => c.theme === t).length)).toEqual([37, 8, 14, 34]);
    expect(ISO_ANNEX_A.every((c) => c.justification && c.evidence)).toBe(true);
    expect(ISO_ANNEX_A.filter((c) => !c.applicable).every((c) => c.status === 'не се применува')).toBe(true);
  });
  it('the confirmed entry wins over the proposal; an excluded control is „не се применува“', () => {
    const L = soaMerge(new Map([['A.8.23', { applicable: true, status: 'спроведено' as const, justification: 'DNS филтер', evidence: 'NextDNS' }], ['A.7.4', { applicable: false, status: 'спроведено' as const, justification: 'Мала канцеларија', evidence: '' }]]));
    expect(L.find((c) => c.id === 'A.8.23')).toMatchObject({ status: 'спроведено', confirmed: true, evidence: 'NextDNS' });
    expect(L.find((c) => c.id === 'A.7.4')).toMatchObject({ applicable: false, status: 'не се применува' });
    expect(soaSummary(L)).toMatchObject({ total: 93, confirmed: 2 });
  });
});

describe('documents and records', () => {
  it('the starting set has scope, context, interested parties and the SoA document, each with a mark and version', () => {
    const D = isoStarterDocs('WISE');
    for (const k of [ISO_DOC.scope, ISO_DOC.context, ISO_DOC.parties, ISO_DOC.roles, ISO_DOC.riskMethod, ISO_DOC.soa, ISO_DOC.docControl, ISO_DOC.hr]) expect(D.some((d) => d.docNo === k)).toBe(true);
    expect(new Set(D.map((d) => d.docNo)).size).toBe(D.length);
    const S = isoStarters('policy', 'WISE');
    expect(S.every((s) => s.data.docNo && s.data.version === '1.0')).toBe(true);
    // every starting field belongs to the register
    for (const k of ['policy', 'supplier', 'auditplan'] as const) {
      const keys = new Set(isoKind(k)!.fields.map((f) => f.k));
      for (const s of isoStarters(k, 'WISE', 2026)) expect(Object.keys(s.data).filter((x) => !keys.has(x))).toEqual([]);
    }
    expect(isoStarters('auditplan', '', 2026).map((s) => s.data.month)).toEqual(['2026-03-15', '2026-06-15', '2026-09-15', '2026-12-15']);
  });
  it('close rules: effectiveness for corrective actions, approval for documents, evaluation for trainings', () => {
    expect(isoCloseCheck('nc', { correction: 'x', cause: 'x', corrective: 'x', verifiedOn: '2026-01-01', effective: 'да' })).toBeNull();
    expect(isoCloseCheck('nc', { correction: 'x', cause: 'x', corrective: 'x', verifiedOn: '2026-01-01' })).toMatch(/ефективна/);
    expect(isoCloseCheck('policy', { docNo: 'ПЛ-01', version: '1.0' })).toMatch(/одобрил/);
    expect(isoCloseCheck('training', { date: '2026-01-01' })).toMatch(/оценка/);
    expect(isoCloseCheck('incident', { action: 'x', personal: 'да' })).toMatch(/АЗЛП/);
    expect(isoCloseCheck('objective', {})).toBeNull();
  });
});

describe('staff (A.6) and the contract', () => {
  const pol = row({ id: 'p', kind: 'policy', status: 'done', title: 'Политика', data: { docNo: 'ПЛ-01', version: '1.1', approvedOn: '2026-02-01' } });
  const P = policiesInForce([pol, row({ id: 'q', kind: 'policy', data: { docNo: 'ПЛ-02', version: '1.0' } })]);
  it('policies in force are the approved ones; a new version needs a new statement', () => {
    expect(P.map((p) => p.docNo)).toEqual(['ПЛ-01']);
    expect(ackString(P)).toBe('ПЛ-01 в1.1');
    expect(ackMissing(P, 'ПЛ-01 в1.0')).toHaveLength(1);
    expect(ackMissing(P, 'ПЛ-01 в1.1')).toHaveLength(0);
  });
  it('a colleague is ready with the signed ISO contract (scan), the current policies, a training this year and access', () => {
    const base = { emp: { id: 'e', name: 'Ана Анева', active: true, start: '2025-01-01', end: null }, user: { id: 'u', active: true, role: 'book' }, policies: P, today: '2026-10-20', izj: null };
    const T = [row({ id: 't', kind: 'training', data: { who: 'Ана Анева', date: '2026-03-01', hours: 4 } })];
    const r = row({ id: 's', kind: 'staff', data: { contractOn: '2026-01-05', ackOn: '2026-02-02', ackDocs: 'ПЛ-01 в1.1' } });
    expect(staffStatus({ ...base, row: r, contract: { no: '1', signDate: '2026-01-05', iso: true }, files: 1, trainings: T })).toMatchObject({ ok: true, hours: 4 });
    const s = staffStatus({ ...base, row: r, contract: { no: '1', signDate: '2026-01-05', iso: false }, files: 0, trainings: [] });
    expect(s).toMatchObject({ ok: false, contract: 'part', training: 'miss', confid: 'miss' });
    expect(s.notes.join(' ')).toMatch(/нов договор/);
    // left, user still active
    expect(staffStatus({ ...base, emp: { ...base.emp, active: false, end: '2026-09-30' }, row: r, contract: null, files: 0, trainings: T }).access).toBe('miss');
  });
  it('the contract articles cover confidentiality after termination, ЗЗЛП, assets, incidents, policies, ethics, discipline', () => {
    const A = isoContractArticles().map((a) => a.t + ' ' + a.p).join(' ');
    for (const w of ['по престанокот', 'Законот за заштита на личните податоци', 'врати', '72 часа', 'обуките', 'IESBA', 'дисциплинска мерка']) expect(A).toContain(w);
    expect(isoContractArticles('ИЗЈАВА ISQM').find((a) => a.t === 'Етика и независност')!.p).toBe('ИЗЈАВА ISQM');
  });
});

describe('certification readiness', () => {
  const ctx = (R: IsoRow[]): ReadyCtx => ({ R, soa: soaMerge(new Map()), staff: [], gdpr: { dpa: 0, activities: 0, statements: 0, requests: { late: 0 }, breaches: { late: 0 } }, clients: 2, clientContracts: 1, year: 2026, today: '2026-10-20' });
  it('an empty office misses the documents; an approved scope is ready; a draft is partly', () => {
    const S = isoReadiness(ctx([]));
    expect(S.map((s) => s.std)).toEqual(['9001', '27001', '27701', '22301']);
    expect(S[0]!.items.find((x) => x.clause === '§4.3')!.state).toBe('miss');
    const R = [
      row({ id: 'sc', kind: 'policy', status: 'done', data: { docNo: ISO_DOC.scope, version: '1.0', approvedOn: '2026-02-01' } }),
      row({ id: 'ct', kind: 'policy', data: { docNo: ISO_DOC.context, version: '1.0' } }),
    ];
    const S2 = isoReadiness(ctx(R));
    expect(S2[0]!.items.find((x) => x.clause === '§4.3')).toMatchObject({ state: 'ok', href: '/iso?k=policy&id=sc' });
    expect(S2[0]!.items.find((x) => x.clause === '§4.1')!.state).toBe('part');
    expect(S2[1]!.items.find((x) => x.id === 'soa')!.state).toBe('miss');
    expect(S2[0]!.items.find((x) => x.id === '8.2.3')!.state).toBe('part');
    expect(S2[0]!.pct).toBeGreaterThan(S[0]!.pct);
  });
  it('the audit programme: planned and done items, late ones', () => {
    const R = [row({ id: 'ap', kind: 'auditplan', data: { std: 'ISO 9001', month: '2026-03-15' } }), row({ id: 'au', kind: 'audit', status: 'done', data: { plan: 'ap', date: '2026-03-20' } })];
    expect(isoReadiness(ctx(R))[0]!.items.find((x) => x.id === '9.2')!.state).toBe('ok');
    const late = [row({ id: 'ap', kind: 'auditplan', data: { std: 'ISO 9001', month: '2026-03-15' } })];
    expect(isoReadiness(ctx(late))[0]!.items.find((x) => x.id === '9.2')).toMatchObject({ state: 'part' });
  });
});
