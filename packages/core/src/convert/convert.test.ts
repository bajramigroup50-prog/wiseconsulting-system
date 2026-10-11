import { describe, expect, it } from 'vitest';
import { CONV_TARGETS, convApply, convAuto, convCheck, convPresetClean, convPresetFor, convSig, convTarget, xmlToGrid, type ConvTarget } from './index';

/** Source as another program exports it: its own headings, „1.234,56“ amounts, d.m.yyyy dates. */
const SRC: Record<string, { head: string[]; rows: unknown[][]; expect: Record<string, string | number>[] }> = {
  bank: {
    head: ['Датум на книжење', 'Назив на налогодавач/примач', 'Опис', 'Реф.', 'Должи', 'Побарува'],
    rows: [['02.03.2026', 'АЛФА ДООЕЛ', 'Плаќање фактура 12', 'R-1', '', '12.500,00'], ['3/3/2026', 'Т-Мобиле', 'Телефон', 'R-2', '1.234,56', ''], ['Вкупно', '', '', '', '1.234,56', '12.500,00']],
    expect: [{ date: '2026-03-02', name: 'АЛФА ДООЕЛ', amount: 12500 }, { date: '2026-03-03', name: 'Т-Мобиле', amount: -1234.56 }],
  },
  ob: {
    head: ['Konto', 'Naziv', 'Partner', 'EDB', 'Saldo'],
    rows: [['1200', 'Купувачи', 'АЛФА ДООЕЛ', '4030000000011', '12.000,00'], ['2200', 'Добавувачи', 'БЕТА ДОО', '4030000000022', '-12.000,00']],
    expect: [{ konto: '1200', partner: 'АЛФА ДООЕЛ', debit: 12000, credit: 0 }, { konto: '2200', partner: 'БЕТА ДОО', debit: 0, credit: 12000 }],
  },
  'imp:partners': {
    head: ['Firma', 'EDB', 'Sifra', 'Adresa', 'Grad', 'Telefon'],
    rows: [['ГАМА ДООЕЛ', '4030000000033', 'P1', 'ул. 1', 'Скопје', '070111222'], ['ДЕЛТА ДОО', '4030000000044', 'P2', 'ул. 2', 'Битола', '']],
    expect: [{ name: 'ГАМА ДООЕЛ', edb: '4030000000033', code: 'P1', city: 'Скопје' }, { name: 'ДЕЛТА ДОО', code: 'P2' }],
  },
  'imp:items': {
    head: ['Šifra', 'Artikl', 'Barkod', 'JM', 'Cena', 'DDV'],
    rows: [['101', 'Кафе 200г', '5310000000017', 'ком', '120,50', '18'], ['102', 'Чај', '', 'ком', '80', '5']],
    expect: [{ code: '101', name: 'Кафе 200г', price: 120.5, rate: 18 }, { code: '102', name: 'Чај', price: 80, rate: 5 }],
  },
  'imp:employees': {
    head: ['Ime i prezime', 'EMBG', 'Pozicija', 'Neto', 'Pocetok'],
    rows: [['Петар Петровски', '0101990450000', 'Возач', '30.000,00', '01.09.2025']],
    expect: [{ name: 'Петар Петровски', embg: '0101990450000', netBase: 30000, start: '2025-09-01' }],
  },
  'imp:purchases': {
    head: ['Br. faktura', 'Datum', 'Dobavuvac', 'EDB', 'Osnovica 18', 'DDV 18', 'Vkupno'],
    rows: [['F-123', '15.09.2026', 'Добавувач ДООЕЛ', '4030000000055', '1.000,00', '180,00', '1.180,00']],
    expect: [{ number: 'F-123', date: '2026-09-15', partner: 'Добавувач ДООЕЛ', base18: 1000, vat18: 180, total: 1180 }],
  },
  'imp:invoices': {
    head: ['Broj', 'Datum', 'Kupuvac', 'Sifra', 'Opis', 'Kolicina', 'Cena', 'DDV'],
    rows: [['001/2026', '15.09.2026', 'Купувач ДОО', '101', 'Кафе', '10', '120', '18'], ['001/2026', '15.09.2026', 'Купувач ДОО', '102', 'Чај', '2', '80', '5']],
    expect: [{ number: '001/2026', date: '2026-09-15', partner: 'Купувач ДОО', qty: 10, price: 120 }, { number: '001/2026', qty: 2, rate: 5 }],
  },
  'imp:journal': {
    head: ['Nalog', 'Datum', 'Konto', 'Dolzi', 'Pobaruva', 'Opis'],
    rows: [['1', '01.01.2026', '1000', '10.000,00', '', 'Почетна'], ['1', '01.01.2026', '9000', '', '10.000,00', 'Почетна']],
    expect: [{ no: '1', date: '2026-01-01', k: '1000', d: 10000 }, { k: '9000', p: 10000 }],
  },
  'imp:stock': {
    head: ['Sifra', 'Naziv', 'Kolicina', 'Nabavna cena', 'Magacin'],
    rows: [['101', 'Кафе', '50', '85,00', '01']],
    expect: [{ code: '101', name: 'Кафе', qty: 50, cost: 85, wh: '01' }],
  },
  'imp:in': {
    head: ['Sifra', 'Naziv', 'Kolicina', 'Nabavna', 'MPC', 'JM', 'DDV %'],
    rows: [['101', 'Кафе', '50', '85', '150', 'ком', '18']],
    expect: [{ code: '101', qty: 50, cost: 85, mpc: 150, rate: 18 }],
  },
  'imp:pop': { head: ['Sifra', 'Naziv', 'Popisano'], rows: [['101', 'Кафе', '48']], expect: [{ code: '101', cnt: 48 }] },
  'imp:nivel': { head: ['Sifra', 'Naziv', 'Nova cena'], rows: [['101', 'Кафе', '140,00']], expect: [{ code: '101', mpc: 140 }] },
  firms: {
    head: ['Naziv', 'EDB', 'Maticen broj', 'Adresa', 'Grad', 'DDV', 'Period'],
    rows: [['АЛФА ТРЕЈД ДООЕЛ', '4030019000011', '7000011', 'ул. Македонија 1', 'Скопје', 'да', 'тромесечно']],
    expect: [{ name: 'АЛФА ТРЕЈД ДООЕЛ', edb: '4030019000011', embs: '7000011', city: 'Скопје', ddv: 'да', per: 'тромесечно' }],
  },
  pay: {
    head: ['EMBG', 'Ime i prezime', 'Neto', 'Godisen odmor', 'Bonus'],
    rows: [['101990450000', 'Петар Петровски', '30.000,00', '16', '2.000']],
    expect: [{ embg: '0101990450000', name: 'Петар Петровски', net: 30000, odm: 16, bonus: 2000 }],
  },
};

describe('converter — round trip through every importer', () => {
  it('has a source sample for every target', () => {
    expect(CONV_TARGETS.map((t) => t.id).sort()).toEqual(Object.keys(SRC).sort());
  });

  for (const t of CONV_TARGETS) {
    it(`${t.id}: other headings → mapping → target file → the importer's own parser reads the same values`, () => {
      const S = SRC[t.id]!;
      const map = convAuto(t, S.head);
      const res = convApply(t, S.rows, map);
      expect(res.errors).toEqual([]);
      const c = convCheck(t, res);
      expect(c.error).toBeUndefined();
      expect(c.diff).toEqual([]);
      expect(c.n).toBe(S.expect.length);
      S.expect.forEach((e, i) => expect(c.rows[i]).toMatchObject(e));
    });

    it(`${t.id}: the target headings are recognised by the importer (every field, own column)`, () => {
      // a record with every field filled must come back through the importer unchanged
      const rec = Object.fromEntries(t.fields.map((f, i) => [f.key, f.kind === 'num' ? i + 1 : f.kind === 'date' ? '05.06.2026' : sample(t, f.key, i)]));
      if (t.id === 'bank') { delete rec.amount; rec.out = 0; }
      if (t.id === 'ob') { delete rec.saldo; rec.credit = 0; }
      if (t.id === 'firms') { rec.ddv = 'да'; rec.per = 'месечно'; }
      const res = convApply(t, [t.fields.map((f) => rec[f.key])], Object.fromEntries(t.fields.map((f, i) => [f.key, i])));
      expect(res.errors).toEqual([]);
      const c = convCheck(t, res);
      expect(c.error).toBeUndefined();
      expect(c.diff).toEqual([]);
    });
  }
});

/** A text value the importer keeps as text for that field. */
function sample(t: ConvTarget, key: string, i: number): string {
  const S: Record<string, string> = {
    konto: '1200', edb: '4030000000011', embs: '7000011', embg: '0101990450000', code: 'C' + i, barcode: '5310000000017', k: '1000', wh: '01',
    ops: '183', fzo: '4061', bank: '200000000000000', email: 'a@b.mk', phone: '070000000', type: 'стока', ddv: 'да', number: 'F-1', no: '7',
    osnov: '930', ref: 'R1', unit: 'ком', lf: 'ДООЕЛ',
  };
  return S[key] ?? (t.id === 'pay' && key === 'name' ? 'Петар Петровски' : 'Текст ' + key);
}

describe('converter — mapping, presets, XML', () => {
  it('auto mapping prefers exact headings and keeps one column per field', () => {
    const t = convTarget('bank')!;
    const m = convAuto(t, ['Датум', 'Износ', 'Опис', 'Налогодавач']);
    expect(m).toMatchObject({ date: 0, amount: 1, purpose: 2, name: 3 });
  });

  it('reports rows without required data and skips total rows', () => {
    const t = convTarget('imp:partners')!;
    const r = convApply(t, [['', '4030000000011'], ['Вкупно', ''], ['АЛФА', '']], { name: 0, edb: 1 });
    expect(r.recs).toHaveLength(1);
    expect(r.errors).toEqual([{ row: 1, msg: 'недостасува: Назив' }]);
  });

  it('a saved preset is found again for the same layout', () => {
    const hdr = ['Datum', 'Iznos', 'Opis'];
    const p = convPresetClean({ name: 'Банка X', target: 'bank', sig: convSig(hdr), hi: 0, map: { date: 0, amount: 1, purpose: 2, bogus: 9 } })!;
    expect(p.map).toEqual({ date: 0, amount: 1, purpose: 2 });
    expect(convPresetFor([p], ['DATUM', 'iznos', 'Opis'])?.name).toBe('Банка X');
    expect(convPresetFor([p], ['Datum', 'Iznos'])).toBeUndefined();
    expect(convPresetClean({ name: 'x', target: 'nope' })).toBeNull();
  });

  it('XML: the repeated element becomes the rows', () => {
    const g = xmlToGrid('<?xml version="1.0"?><Izvod><Broj>5</Broj><Stavki><Stavka id="1"><Datum>2026-03-02</Datum><Iznos>100</Iznos><Opis>A</Opis></Stavka><Stavka id="2"><Datum>2026-03-03</Datum><Iznos>-5,5</Iznos><Opis>B</Opis></Stavka></Stavki></Izvod>')!;
    expect(g[0]).toEqual(['@id', 'Datum', 'Iznos', 'Opis']);
    expect(g.slice(1)).toEqual([['1', '2026-03-02', '100', 'A'], ['2', '2026-03-03', '-5,5', 'B']]);
    const t = convTarget('bank')!;
    const res = convApply(t, g.slice(1), convAuto(t, g[0]!));
    expect(convCheck(t, res).rows.map((r) => r.amount)).toEqual([100, -5.5]);
  });
});
