/**
 * Bank line forms: „Изводи во налогот“ (одлив left / прилив right, posting controls on their own line, cross-script
 * partner picker preselected from the statement, „прилив на 2200?“) and the „+ Ново конто“ konto field.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock('@/app/(app)/banka/actions', () => ({
  bookAllAction: async () => ({}), deleteLineAction: async () => ({}), flipLineAction: async () => ({}), linkLineAction: async () => ({}), setKontoAction: async () => ({}),
  setPartnerAction: async () => ({}), unlinkLineAction: async () => ({}), updateStatementAction: async () => ({}),
}));
vi.mock('@/app/(app)/nalozi/statement-actions', () => ({ lineDocsAction: async () => ({}), saveStatementLinesAction: async () => ({}) }));

const { StatementsPanel } = await import('@/app/(app)/nalozi/statements-panel');
const { KontoField } = await import('./konto-field');

const line = (o: Record<string, unknown>) => ({
  id: 'l1', date: '2026-07-10', name: 'ВЕНГ ХАУС ДОО Скопје', purpose: 'уплата', amount: 3540, amountCur: null, cur: null, osnov: '', konto: '2200', effK: '2200',
  partnerId: '', newPartner: '', guessPid: 'v', linked: false, refLabel: '', refType: '', manual: false, prob: 'нема комитент', sugg: null, ...o,
});
const panel = (lines: ReturnType<typeof line>[]) => renderToStaticMarkup(
  <StatementsPanel write del flip chart={[['1200', 'Купувачи'], ['2200', 'Добавувачи'], ['103', 'Девизни'], ['1030', 'Девизни сметки'], ['10301', 'EUR']]}
    partners={[{ id: 'v', code: '0412', name: 'VENG HAUS DOO SKOPJE' }]}
    statements={[{ id: 's', number: '7', date: '2026-07-10', acct: 'НЛБ', bankKonto: '1000', fx: false, cur: 'MKD', opening: 0, closing: 3540, status: 'open', locked: '', lines }]} />,
);

describe('Изводи во налогот', () => {
  it('одлив before прилив; the inflow on 2200 is questioned; the statement partner (Latin) is preselected for „ВЕНГ ХАУС“', () => {
    const h = panel([line({})]);
    expect(h.indexOf('>Одлив<')).toBeGreaterThan(0);
    expect(h.indexOf('>Одлив<')).toBeLessThan(h.indexOf('>Прилив<'));
    expect(h).toContain('прилив на 2200?');
    expect(h).toContain('value="0412 · VENG HAUS DOO SKOPJE"');
    expect(h).toContain('потврдете со ✓');
    expect(h).not.toContain('list="nalBkP"'); // no native datalist over the table
  });
  it('a synthetic konto with analytics offers the analytic', () => {
    const h = panel([line({ konto: '1030', effK: '1030', amount: -100, guessPid: '' })]);
    expect(h).toContain('синтетичко конто – изберете аналитика');
    expect(h).toContain('10301');
  });
});

describe('„+ Ново конто“', () => {
  it('a konto missing from the chart under an existing synthetic offers creating it', () => {
    const h = renderToStaticMarkup(<KontoField chart={[['447', 'Други трошоци'], ['4460', 'Банкарски услуги']]} defaultValue="44792" />);
    expect(h).toContain('+ Ново конто 44792');
    expect(h).toContain('name="newKonto"');
  });
  it('an existing konto shows its name', () => {
    expect(renderToStaticMarkup(<KontoField chart={[['4460', 'Банкарски услуги']]} defaultValue="4460" />)).toContain('Банкарски услуги');
  });
});
