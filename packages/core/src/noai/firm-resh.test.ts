import { describe, expect, it } from 'vitest';
import { DDV_POTVRDA, DDV_RESH, HISTORIJAT, OTHER, TEKOVNA, UPIS } from './firm-resh.fixtures';
import { edbOf, embsOf, mergeResh, reshFromText, reshMissing, RESH_NOAI_NOTE, splitSeat } from './firm-resh';
import { lineText, pdfLines, type PdfItem } from './pdf-lines';

const read = (t: string) => reshFromText(t.split('\n'));

describe('free read of firm registration documents', () => {
  it('ЦРСМ Решение за упис', () => {
    const r = read(UPIS)!;
    expect(r).toMatchObject({
      docType: 'upis', docNumber: '0806-2026/0012345', docDate: '2026-03-12', regDate: '2026-03-12',
      name: 'Друштво за производство и трговија ПРИМЕР СОФТ ДООЕЛ Скопје', short: 'ПРИМЕР СОФТ ДООЕЛ', lf: 'dooel',
      embs: '7999001', edb: '4030026999012', address: 'ул. Тестна бр. 15/2', city: 'Скопје', municipality: 'Карпош',
      nkd: '62.01', activity: 'Компјутерско програмирање', capital: 5000, capitalCur: 'EUR', signer: 'Петар Петровски',
      founders: [{ name: 'Петар Петровски', share: '100%' }], bank: '300000001234567', bankName: 'Тестна Банка АД Скопје',
      email: 'info@primer-soft.test', phone: '02/3123-456', ddv: false, vatFrom: '', noai: true, note: RESH_NOAI_NOTE,
    });
    expect(r.otherNkd).toEqual(['46.90', '47.91']);
    expect(r.warnings).toEqual([]);
    expect(reshMissing(r)).toEqual([]);
  });

  it('ЦРСМ Тековна состојба (table cells, values on the next line, separate street / number / place)', () => {
    const r = read(TEKOVNA)!;
    expect(r).toMatchObject({
      docType: 'tekovna', docNumber: '30120260098765', docDate: '2026-05-05', regDate: '2019-02-14',
      name: 'ТРГОВСКО ДРУШТВО ЗА УСЛУГИ ДЕМО ТРЕЈД ДОО увоз-извоз Битола', short: 'ДЕМО ТРЕЈД ДОО Битола', lf: 'doo',
      embs: '7999002', edb: '4002019999034', address: 'ШИРОК СОКАК бр. 101', city: 'БИТОЛА', municipality: 'БИТОЛА',
      nkd: '56.10', activity: 'Ресторани и останати објекти за подготовка и послужување на храна', capital: 307500, capitalCur: 'MKD',
      signer: 'Иван Демовски', bank: '210000000099977', bankName: 'Демо Банка АД Скопје',
    });
    expect(r.founders).toEqual([{ name: 'Марија Демовска', share: '50%' }, { name: 'Иван Демовски', share: '50%' }]);
    expect(r.warnings).toEqual([]);
  });

  it('ЦРСМ Историјат of a трговец поединец', () => {
    const r = read(HISTORIJAT)!;
    expect(r).toMatchObject({
      docType: 'tekovna', docDate: '2026-06-20', regDate: '2020-09-01', name: 'Трговец поединец Лаже Тестовски ТП Охрид', lf: 'tp',
      embs: '7999003', edb: '5013019999046', address: 'Бул. Пробен бр. 7', city: 'Охрид', nkd: '96.02',
      activity: 'Фризерски салони и салони за разубавување', signer: 'Лаже Тестовски',
    });
    expect(reshMissing(r)).toEqual([]);
  });

  it('УЈП Решение за регистрација за ДДВ: ДДВ обврзник + датум од', () => {
    const r = read(DDV_RESH)!;
    expect(r).toMatchObject({
      docType: 'ddv', docNumber: '13-0044/7', docDate: '2026-04-02', name: 'ПРИМЕР СОФТ ДООЕЛ Скопје', lf: 'dooel',
      edb: '4030026999012', ddv: true, vatFrom: '2026-05-01', address: 'ул. Тестна бр. 15/2', city: 'Скопје',
    });
    expect(reshMissing(r)).toEqual([]);
  });

  it('УЈП Потврда за регистрација за ДДВ', () => {
    const r = read(DDV_POTVRDA)!;
    expect(r).toMatchObject({ docType: 'ddv', name: 'ДЕМО ТРЕЈД ДОО Битола', lf: 'doo', edb: '4002019999034', ddv: true, vatFrom: '2026-07-01', docDate: '2026-06-25' });
    expect(reshMissing(r)).toEqual([]);
  });

  it('Тековна состојба + ДДВ потврда merged: the firm with the ДДВ date', () => {
    const m = mergeResh([read(DDV_POTVRDA)!, read(TEKOVNA)!])!;
    expect(m).toMatchObject({ docType: 'tekovna', embs: '7999002', edb: '4002019999034', ddv: true, vatFrom: '2026-07-01', nkd: '56.10', warnings: [] });
  });

  it('not a registration document / no text → null; missing required fields are reported', () => {
    expect(read(OTHER)).toBeNull();
    expect(reshFromText([])).toBeNull();
    const r = read('ЦЕНТРАЛЕН РЕГИСТАР\nРЕШЕНИЕ за упис\nЦелосен назив: НЕШТО ДООЕЛ Скопје\nЕМБС: 12345\n')!;
    expect(r.embs).toBe('');
    expect(reshMissing(r)).toEqual(['ЕМБС / ЕДБ']);
    expect(r.warnings.join(' | ')).toMatch(/ЕМБС „12345“ не е 7 цифри.*Не се најде: ЕМБС \/ ЕДБ/);
  });

  it('number formats: ЕМБС 7 digits (leading 0 of 8 dropped), ЕДБ 13 digits with or without МК', () => {
    expect(embsOf('07999001')).toBe('7999001');
    expect(embsOf('799 9001')).toBe('7999001');
    expect(embsOf('123456')).toBe('');
    expect(edbOf('МК 4030026999012')).toBe('4030026999012');
    expect(edbOf('MK4030026999012')).toBe('4030026999012');
    expect(edbOf('4030 0269 99012')).toBe('4030026999012');
    expect(edbOf('300000001234567')).toBe('');
    expect(splitSeat('ул. „Тестна“ бр. 3, 1000 Скопје - Центар')).toEqual({ address: 'ул. "Тестна" бр. 3', city: 'Скопје', municipality: 'Центар' });
    expect(splitSeat('УЛ. ТЕСТНА бр.3 КУМАНОВО')).toEqual({ address: 'УЛ. ТЕСТНА бр.3', city: 'КУМАНОВО', municipality: '' });
  });

  it('from the PDF text layer (positioned items → lines → cells)', () => {
    const rows: [number, [number, string][]][] = [
      [800, [[40, 'Централен регистар на Република Северна Македонија']]],
      [780, [[40, 'ТЕКОВНА СОСТОЈБА']]],
      [760, [[40, 'ЕМБС'], [200, '7999002']]],
      [745, [[40, 'Целосен назив'], [200, 'ДЕМО ТРЕЈД ДОО Битола']]],
      [730, [[40, 'ЕДБ'], [200, 'МК4002019999034']]],
      [715, [[40, 'Седиште'], [200, 'ШИРОК СОКАК бр. 101, БИТОЛА']]],
      [700, [[40, 'Приоритетна дејност'], [200, '56.10'], [240, 'Ресторани']]],
    ];
    const items: PdfItem[] = rows.flatMap(([y, cells]) => cells.map(([x, s]) => ({ page: 1, x, y, w: s.length * 4.5, h: 9, s })));
    const r = reshFromText(pdfLines(items).map(lineText))!;
    expect(r).toMatchObject({ docType: 'tekovna', embs: '7999002', edb: '4002019999034', name: 'ДЕМО ТРЕЈД ДОО Битола', address: 'ШИРОК СОКАК бр. 101', city: 'БИТОЛА', nkd: '56.10', activity: 'Ресторани' });
  });
});
