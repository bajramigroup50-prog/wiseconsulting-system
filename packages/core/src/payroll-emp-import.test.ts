import { describe, expect, it } from 'vitest';
import { EMP_TEMPLATE, empParse } from './payroll/emp-import';

describe('employees from Excel (legacy XT.employees / IMP_T.employees)', () => {
  it('reads the legacy template', () => {
    const R = empParse(EMP_TEMPLATE.map((r) => r.map(String)));
    if ('error' in R) throw new Error(R.error);
    expect(R.map((x) => [x.no, x.name, x.embg, x.netBase, x.coef, x.stazPrev])).toEqual([
      ['25', 'Абдулау Адем', '0101990450001', '26046', '1', '5'],
      ['26', 'Марко Марковски', '0202985450002', '30000', '1', '12'],
    ]);
  });
  it('aliases, padded ЕМБГ, dates', () => {
    const R = empParse([['Emri', 'EMBG', 'Neto', 'Data e punesimit'], ['Ana', '101990450001', '25.000,00', '01.09.2026']]);
    if ('error' in R) throw new Error(R.error);
    expect(R[0]).toMatchObject({ name: 'Ana', embg: '0101990450001', netBase: '25000', start: '2026-09-01' });
    expect(empParse([['x']])).toHaveProperty('error');
  });
});
