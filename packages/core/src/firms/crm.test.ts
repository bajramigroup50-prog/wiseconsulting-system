import { describe, expect, it } from 'vitest';
import { crmFromWebForm, crmOfferHtml, crmOfferNew, crmOfferNormalize, crmOfferNumber, crmStats } from './crm';

describe('CRM', () => {
  it('stats: by stage, by source, win rate over closed leads', () => {
    const s = crmStats([
      { stage: 'nov', source: 'web', fee: 3000 }, { stage: 'dobien', source: 'web', fee: 5000 },
      { stage: 'izguben', source: 'telefon' }, { stage: 'dobien', source: 'preporaka', fee: '4000' }, { stage: 'ponuda', source: 'web', fee: 2000 },
    ]);
    expect(s.total).toBe(5); expect(s.open).toBe(2); expect(s.won).toBe(2); expect(s.lost).toBe(1);
    expect(s.winRate).toBe(66.7); expect(s.pipelineFee).toBe(5000); expect(s.wonFee).toBe(9000);
    expect(s.bySource.find((x) => x.source === 'web')).toMatchObject({ n: 3, won: 1, lost: 0, winRate: 100 });
    expect(s.byStage.find((x) => x.stage === 'nov')!.n).toBe(1);
    expect(crmStats([]).winRate).toBeNull();
  });
  it('offer: new, normalize, html', () => {
    const p = crmOfferNew({ empFree: 3 }, { company: 'Тест ДООЕЛ', fee: 4500 }, '2026-11-14');
    expect(p.validUntil).toBe('2026-12-14'); expect(p.fee).toBe(4500);
    const n = crmOfferNormalize({ ...p, svc: ['book', 'xx'], fee: '3.000', docDay: 99 }, '2026-11-14');
    expect(n.svc).toEqual(['book']); expect(n.docDay).toBe(28);
    expect(crmOfferNumber(7, 2026)).toBe('ПН-007/2026');
    const h = crmOfferHtml({ ...p, number: 'ПН-001/2026' }, { lead: { company: 'Тест <b>' }, O: { name: 'БАЈРАМИ ГРОУП ДООЕЛ Скопје', vatRate: 18 }, img: (i) => i });
    expect(h).toContain('ПОНУДА'); expect(h).toContain('Тест &lt;b&gt;'); expect(h).toContain('4.500,00'); expect(h).toContain('5.310,00');
  });
  it('web form', () => {
    expect(crmFromWebForm({ name: 'Ана', email: 'a@b.mk' })).toMatchObject({ company: 'Ана', contact: 'Ана' });
    expect(crmFromWebForm({ name: 'Ана' })).toBeNull();
    expect(crmFromWebForm({ name: 'Ана', email: 'bad' })).toBeNull();
  });
});
