import { describe, expect, it } from 'vitest';
import { elFileNormalize, elFileStatus, QC_REVIEW, qcNormalize, qcReviewed } from './ifac';
import {
  CPD_MIN_YEAR, crHtml, formMeta, ifacReadiness, roleCompetence, SQM_COMPONENTS, sqmComp, sqmNormalize, sqmStarter, sqmStatus, staffNormalize, staffStatus, type ReadyInput,
} from './ifac-sqm';

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';

describe('ISQM 1 components', () => {
  it('nine components incl. monitoring and the annual evaluation; the status needs text, owner, sign-off and evidence', () => {
    expect(SQM_COMPONENTS.map((c) => c.k)).toEqual(['risk', 'gov', 'ethics', 'accept', 'perf', 'res', 'info', 'monitor', 'eval']);
    const c = sqmComp('monitor')!;
    const d = sqmNormalize(c, { inspected: 'АЛФА 2025 – Б.', findings: 'нема', junk: 'x', owner: A, signedBy: A, signedOn: '2026-10-01' });
    expect(d).toEqual({ inspected: 'АЛФА 2025 – Б.', findings: 'нема', owner: A, signedBy: A, signedOn: '2026-10-01' });
    expect(sqmStatus(c, d, 0)).toMatchObject({ documented: true, signed: true, evidence: false, ok: false });
    expect(sqmStatus(c, d, 1).ok).toBe(true);
    expect(sqmStatus(sqmComp('eval')!, sqmNormalize(sqmComp('eval')!, { conclusion: 'нешто друго' }), 1).missing).toContain('Заклучок');
    const st = sqmStarter('WISE');
    expect(Object.keys(st)).toEqual(['risk', 'gov', 'ethics', 'accept', 'perf', 'res', 'info']);
    expect(st.gov!.culture).toContain('WISE');
  });
  it('who / when / version of a form', () => {
    expect(formMeta({ _v: 3, _by: A, _at: '2026-10-20T10:00:00Z' })).toEqual({ v: 3, by: A, at: '2026-10-20T10:00:00Z' });
    expect(formMeta(null).v).toBe(0);
  });
});

describe('people – competence and CPD', () => {
  it('assessed by someone else, requirements of the role, CPD hours of a licensed accountant', () => {
    const req = roleCompetence('acc');
    const met = Object.fromEntries(req.map((_, i) => [String(i), true]));
    const d = staffNormalize({ met, licensed: true, licence: 'ИСОС-12', cpd: [{ date: '2026-03-01', topic: 'Даночни измени', provider: 'ИСОС', hours: '12' }, { date: '', topic: 'x', hours: 3 }], assessedBy: B, assessedOn: '2026-09-01' });
    expect(d.cpd).toHaveLength(1);
    let s = staffStatus('acc', d, A, { y1: 50, y2: 40 });
    expect([s.assessed, s.met, s.hours, s.cpdOk, s.three, s.three3Ok, s.ok]).toEqual([true, req.length, 12, false, 102, false, false]);
    s = staffStatus('acc', { ...d, cpd: [...d.cpd, { date: '2026-05-01', topic: 'МСФИ', provider: 'ИСОС', hours: CPD_MIN_YEAR, structured: true }] }, A, { y1: 50, y2: 40 });
    expect([s.cpdOk, s.three3Ok, s.ok]).toEqual([true, true, true]);
    expect(staffStatus('acc', { ...d, assessedBy: A }, A).assessed).toBe(false);
    // one-person office: the owner assessed by someone outside
    expect(staffStatus('acc', { ...d, assessedBy: A, assessedExt: 'Б. Б., овластен сметководител' }, A).assessed).toBe(true);
    expect(qcReviewed(qcNormalize({ rev: Object.fromEntries(QC_REVIEW.map((x) => [x.k, true])), preparedBy: A, reviewedExt: 'В. В., ИСОС-44', reviewedOn: '2027-03-01' } as never))).toBe(true);
    expect(staffStatus('oper', staffNormalize({ met: { 0: true, 1: true, 2: true }, assessedBy: B, assessedOn: '2026-09-01' }), A).ok).toBe(true);
  });
});

describe('ISRS 4410 engagement file and compiler report', () => {
  it('the file is complete with matters, judgments, communication, the acknowledgement, the report and evidence', () => {
    const f = elFileNormalize({ matters: 'Попис', judgments: 'Резервирање', commOn: '2027-02-10', comm: 'Состанок', ackOn: '2027-02-20', ackBy: 'Ана, управител', reportOn: '2027-02-25' });
    expect(elFileStatus(f, 0).ok).toBe(false);
    expect(elFileStatus(f, 1)).toMatchObject({ done: 6, ok: true });
    const h = crHtml({ name: 'АЛФА ДООЕЛ', city: 'Тетово' }, { name: 'WISE', city: 'Скопје', rep: 'Р.' }, 2026, null, f, 'МСФИ за МСЕ');
    for (const t of ['ИЗВЕШТАЈ НА СМЕТКОВОДИТЕЛОТ ЗА СОСТАВУВАЊЕ', 'ISRS 4410', '31.12.2026', 'АЛФА ДООЕЛ', 'МСФИ за МСЕ', 'Одговорност на раководството', 'не е ревизија', 'IESBA', '25.02.2027']) expect(h).toContain(t);
  });
});

describe('readiness', () => {
  it('lists every component, the people and the engagements; 100% when all is in place', () => {
    const rev = Object.fromEntries(QC_REVIEW.map((x) => [x.k, true]));
    const full = (c: (typeof SQM_COMPONENTS)[number]) => ({ ...Object.fromEntries(c.fields.map((f) => [f.k, f.t === 'date' ? '2026-10-01' : f.o ? f.o[1] : 'текст'])), owner: A, signedBy: A, signedOn: '2026-10-01' });
    const doc = elFileNormalize({ matters: 'x', judgments: 'x', commOn: '2026-02-01', comm: 'x', ackOn: '2026-02-01', ackBy: 'x', reportOn: '2026-02-02' });
    const req = roleCompetence('admin');
    const X: ReadyInput = {
      year: 2026, today: '2026-10-20',
      sqm: Object.fromEntries(SQM_COMPONENTS.map((c) => [c.k, { d: full(c), files: 1 }])),
      staff: [{ id: A, name: 'Ана', role: 'admin', d: staffNormalize({ met: Object.fromEntries(req.map((_, i) => [String(i), true])), licensed: true, cpd: [{ date: '2026-01-01', topic: 't', provider: 'p', hours: 40 }], assessedBy: B, assessedOn: '2026-02-01' }), prev: { y1: 40, y2: 40 }, ethicsAt: '2026-01-05', files: 1 }],
      firms: [{ id: 'f', name: 'АЛФА', letter: 'signed', qc: qcNormalize({ decision: 'continue', decidedBy: A, decidedOn: '2026-01-10' } as never), qcPrev: qcNormalize({ rev, preparedBy: A, reviewedBy: B, reviewedOn: '2026-02-01', doc } as never), docFiles: 1 }],
    };
    const V = ifacReadiness(X);
    expect(V.sections.map((s) => s.k)).toEqual(['sqm', 'people', 'eng']);
    expect(V.sections.flatMap((s) => s.items).filter((i) => !i.ok).map((i) => i.n)).toEqual([]);
    expect(V.pct).toBe(100);
    const V2 = ifacReadiness({ ...X, sqm: { ...X.sqm, eval: { d: null, files: 0 } }, staff: [{ ...X.staff[0]!, ethicsAt: null }], firms: [{ ...X.firms[0]!, letter: 'draft' }] });
    const bad = V2.sections.flatMap((s) => s.items).filter((i) => !i.ok);
    expect(bad.map((i) => i.href)).toEqual(['/ifac?t=sqm&c=eval', '/ifac?t=sqm&c=eval', '/ifac?t=sqm&c=eval', '/ifac?t=et', '/ifac?t=all']);
    expect(bad.at(-1)!.info).toBe('АЛФА');
    expect(V2.pct).toBeLessThan(100);
  });
});
