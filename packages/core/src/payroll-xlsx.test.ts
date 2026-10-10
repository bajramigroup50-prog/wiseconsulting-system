import { describe, expect, it } from 'vitest';
import { PXL_COLS, plxEmp, plxFileName, plxMatch, plxN, plxParse, plxTemplate } from './payroll/xlsx-import';
import { resolvePayParams } from './payroll/params';
import { monthHours, monthSplit } from './payroll/calendar';

const P = { ...resolvePayParams({}, '2026-03'), hours: monthHours('2026-03') };
const M = monthSplit('2026-03');

describe('Плата од Excel (legacy plxTpl / plxImp)', () => {
  it('template rows line up with the 28 header columns (FIX: legacy misaligned rows)', () => {
    const [s, help] = plxTemplate('2026-03', [{ no: '2', name: 'Б', embg: '0101990450001', netBase: 30000, coef: 1, city: 'Скопје' }, { no: '10', name: 'А', netBase: '25000' }], M);
    expect(s!.name).toBe('Плата 2026-03');
    expect(s!.rows[0]).toHaveLength(28);
    const col = (k: string) => PXL_COLS.findIndex((c) => c[0] === k);
    expect(s!.rows[1]![col('name')]).toBe('Б');
    expect(s!.rows[2]![col('name')]).toBe('А');
    expect(s!.rows[1]![col('net')]).toBe(30000);
    expect(s!.rows[1]![col('regPlan')]).toBe(M.work);
    expect(help!.name).toBe('Упатство');
    expect(plxFileName('2026-03', 'Фирма ДОО Скопје')).toBe('Plata_2026-03_Фирма_ДОО_Скопје.xlsx');
  });

  it('normalises Turkish / Albanian headers', () => {
    expect(plxN('İsim')).toBe('isim');
    expect(plxN('Njësia')).toBe('njesia');
  });

  it('parses a foreign-language sheet, pads ЕМБГ and skips the totals row', () => {
    const aoa = [
      ['Lista e pagave'],
      ['TC Kimlik', 'Ad Soyad', 'Görev', 'Maaş', 'Resmi mesai', 'Çalıştığı resmi mesai', 'Ekstra mesai', 'Prim', 'Toplam ödeme'],
      ['101990450001', 'Ali Veli', 'Шанкер', '25.000,00', 22, 21, 4, 1000, ''],
      ['', 'Toplam', '', '', '', '', '', '', ''],
    ];
    const r = plxParse(aoa);
    if ('error' in r) throw new Error(r.error);
    expect(r.rows).toHaveLength(1);
    const x = r.rows[0]!;
    expect(x.embg).toBe('0101990450001');
    expect(x.name).toBe('Ali Veli');
    expect(x.net).toBe(25000);
    expect(x.reg).toBe(21);
    expect(x.regPlan).toBe(22);
    expect(x.hours.ot).toBe(4);
    expect(x.bonus).toBe(1000);
  });

  it('refuses unknown sheets', () => {
    expect(plxParse([['a', 'b', 'c'], [1, 2, 3]])).toEqual({ error: 'Не се препознаени колоните. Користете го „Excel образец“.' });
  });

  it('builds the run employee: days → hours, lines, bonus, warnings', () => {
    const r = plxParse([PXL_COLS.map((c) => c[1]), ['0101990450001', 'Ана Ана', '', '', '', '30000', '', '', '', '', '', '21', '', '8', '', '', '2', '', '', '', '', '500', '', '', '', '', '999', '']]);
    if ('error' in r) throw new Error(r.error);
    const rec = r.rows[0]!;
    const E = { id: 'e1', no: '1', name: 'Ана Ана', embg: '0101990450001' };
    expect(plxMatch(rec, [E])).toBe(E);
    const { e, warn } = plxEmp(rec, E, '2026-03', P, M);
    const L = e.lines!;
    expect(L[0]).toMatchObject({ type: 'Редовно работење', hours: 168 });
    expect(L.find((l) => l.type === 'Годишен одмор')?.hours).toBe(8);
    expect(L.find((l) => l.type === 'Прекувремена работа')).toMatchObject({ hours: 2, pct: 150 });
    expect(L.find((l) => l.type === 'Награда / бонус')).toMatchObject({ amt: 500, cat: 'kor' });
    expect(warn.some((w) => w.includes('општина 999'))).toBe(true);
    expect(warn.some((w) => w.includes('нема датум на вработување'))).toBe(true);
  });

  it('empty regular hours → calendar minus absences (fixRegular)', () => {
    const r = plxParse([['ЕМБГ', 'Име и презиме', 'Нето плата', 'Годишен одмор (ч)'], ['0101990450001', 'Б', '30000', '16']]);
    if ('error' in r) throw new Error(r.error);
    const { e } = plxEmp(r.rows[0]!, { id: 'x', name: 'Б', start: '2020-01-01' }, '2026-03', P, M);
    const reg = e.lines!.find((l) => l.type === 'Редовно работење')!;
    const abs = e.lines!.filter((l) => l.type !== 'Редовно работење').reduce((s, l) => s + +(l.hours ?? 0), 0);
    expect(+reg.hours! + abs).toBe(P.hours);
  });
});
