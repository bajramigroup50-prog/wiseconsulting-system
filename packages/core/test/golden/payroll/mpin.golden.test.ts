import { describe, expect, it } from 'vitest';
import {
  decodeCp1251,
  encodeCp1251,
  MPIN_FZO,
  MPIN_OPS,
  mpFzoFrom,
  mpinEmpCodes,
  mpinParamDiff,
  mpinParse,
  mpinTxt,
  mpOpsFrom,
  type MpinTxtResult,
  type PayEmp,
} from '../../../src/payroll';
import { EMP_MIN, EMPLOYEES, FIRM, MONTH, NORMAL_EMPS, PARAMS, TEMPLATE_TXT } from './fixtures';
import { loadLegacy, plain } from './legacy';

const L = loadLegacy();
const bytes = (u: Uint8Array) => Buffer.from(u);

/** Run legacy `mpinTxt` (final wrapper) with the given firm/template and return plain data + cp1251 bytes. */
function legacyMpin(emps: PayEmp[], opts: { tpl?: unknown; params?: unknown } = {}) {
  L.setState({ firm: { ...FIRM, ...(opts.tpl ? { mpinTpl: opts.tpl } : {}) }, employees: structuredClone(EMPLOYEES) });
  const X = L.mpinTxt({ month: MONTH, params: opts.params || PARAMS, emps });
  return { ...plain(X), bytes: Buffer.from(L.toCp1251(X.text)) } as MpinTxtResult & { bytes: Buffer };
}

const EMPS: PayEmp[] = [...NORMAL_EMPS, { ...EMP_MIN, empId: 'e1', no: '1b', inout: 'out', ioDate: '2026-09-20' }];

describe('MPIN code lists', () => {
  it('match legacy MPIN_OPS / MPIN_FZO', () => {
    expect(MPIN_OPS.map((x) => [x.code, x.name])).toEqual(plain(L.MPIN_OPS));
    expect(MPIN_FZO.map((x) => [x.code, x.name])).toEqual(plain(L.MPIN_FZO));
  });
  it('code inference from city / address matches legacy', () => {
    const texts = ['Скопје', 'Кисела Вода, Скопје', 'с. Арачиново', 'Охрид', 'Мак. Брод', 'Македонски Брод', 'Штип', 'ул. Илинденска 5, Битола', 'Град Скопје', '', 'Berlin', 'Чаир'];
    for (const t of texts) {
      expect(mpOpsFrom(t)).toBe(L.mpOpsFrom(t));
      for (const ops of ['', '152', '183', mpOpsFrom(t)]) expect(mpFzoFrom(ops, t)).toBe(L.mpFzoFrom(ops, t));
    }
    for (const E of EMPLOYEES) expect(mpinEmpCodes(E)).toEqual(plain(L.mpinEmpCodes(E)));
  });
});

describe('mpinTxt — MPI3 byte-for-byte', () => {
  it('without template', () => {
    const legacy = legacyMpin(EMPS);
    const port = mpinTxt({ month: MONTH, params: PARAMS, emps: EMPS }, { firm: FIRM, employees: EMPLOYEES });
    expect(port.text).toBe(legacy.text);
    expect(bytes(port.bytes)).toEqual(legacy.bytes);
    expect(port.name).toBe(legacy.name);
    expect(port.name).toBe('MPI3_4030000000001_2026_09_101_110.txt');
    expect(plain(port.R)).toEqual(legacy.R);
    expect(port.miss).toBe(legacy.miss);
    expect(port.tpl).toBe(false);
    expect(port.opsMiss).toEqual(legacy.opsMiss);
    expect(port.opsMiss).toEqual(['Сашо Димитров']);
    expect(decodeCp1251(port.bytes)).toBe(port.text);
  });

  it('with a parsed template (header, codes, names, version from the template)', () => {
    const tplL = L.mpinParse(TEMPLATE_TXT);
    const tplP = mpinParse(TEMPLATE_TXT);
    expect(plain(tplP)).toEqual(plain(tplL));
    const legacy = legacyMpin(EMPS, { tpl: tplL });
    const port = mpinTxt({ month: MONTH, params: PARAMS, emps: EMPS }, { firm: FIRM, employees: EMPLOYEES, template: tplP });
    expect(port.text).toBe(legacy.text);
    expect(bytes(port.bytes)).toEqual(legacy.bytes);
    expect(plain(port.R)).toEqual(legacy.R);
    expect(port.tpl).toBe(true);
    expect(port.text.endsWith('1.0.3328.99999\r\n')).toBe(true);
    // FIX (#9): legacy warned about Сашо although the template supplies his municipality (177)
    expect(legacy.opsMiss).toEqual(['Сашо Димитров']);
    expect(port.opsMiss).toEqual([]);
    expect(port.R.find((r) => r.embg === '0707987450007')!.c6).toBe('177');
  });

  it('FIX: an explicit employee code beats the template (legacy: template won)', () => {
    const txt = TEMPLATE_TXT.replace(
      '***',
      ['3', '0303988455003', 'ТРАЈКОВСКА НИКОЛОВА', 'ЕЛЕНА', '001', '4061', '183', '23', '176', '', '', '1.00', ...Array(14).fill(''), '0050', ...Array(15).fill(''), '1', '', '', '', ''].join(';') + '\r\n***',
    );
    const legacy = legacyMpin(EMPS, { tpl: L.mpinParse(txt) });
    const port = mpinTxt({ month: MONTH, params: PARAMS, emps: EMPS }, { firm: FIRM, employees: EMPLOYEES, template: mpinParse(txt) });
    const lr = legacy.R.find((r) => r.embg === '0303988455003')!;
    const pr = port.R.find((r) => r.embg === '0303988455003')!;
    expect(lr.c6).toBe('183'); // template
    expect(pr.c6).toBe('152'); // employee card (Охрид)
    expect(pr.c5).toBe('4061'); // no explicit ФЗО on the card → template
    // every other employee row is identical
    expect(port.R.filter((r) => r !== pr)).toEqual(legacy.R.filter((r) => r.embg !== '0303988455003'));
  });

  it('FIX: header rates come from the run params (legacy mixed official header with overridden amounts)', () => {
    const params = { ...PARAMS, pio: 18.8, vrab: 1.2 };
    const legacy = legacyMpin(EMPS, { params });
    const port = mpinTxt({ month: MONTH, params, emps: EMPS }, { firm: FIRM, employees: EMPLOYEES });
    const h = (t: string) => t.split('\r\n')[0]!.split(';');
    expect(h(legacy.text)[2]).toBe('19.9');
    expect(h(legacy.text)[5]).toBe('0.1');
    expect(h(port.text)[2]).toBe('18.8');
    expect(h(port.text)[5]).toBe('1.2');
    // amounts are identical in both — only the header changed
    expect(port.text.split('\r\n').slice(1)).toEqual(legacy.text.split('\r\n').slice(1));
    // and the export guard reports the difference, like legacy mpinParamDiff
    expect(mpinParamDiff(MONTH, params)).toEqual(plain(L.mpinParamDiff({ month: MONTH, params })));
    expect(mpinParamDiff(MONTH, params)).toHaveLength(2);
    expect(mpinParamDiff(MONTH, PARAMS)).toEqual([]);
  });
});

describe('cp1251 encoder', () => {
  it('every character legacy encoded gives the same byte', () => {
    let lost = 0;
    for (let c = 0; c <= 0xffff; c++) {
      const s = String.fromCharCode(c);
      const l = L.toCp1251(s)[0];
      const p = encodeCp1251(s)[0];
      if (l !== 0x3f || c === 0x3f) expect(p).toBe(l);
      else if (p !== 0x3f) lost++;
    }
    // FIX: characters legacy turned into '?' although cp1251 has them
    expect(lost).toBe(24);
    expect([...encodeCp1251('€…‘•™§° ')]).toEqual([0x88, 0x85, 0x91, 0x95, 0x99, 0xa7, 0xb0, 0xa0]);
  });

  it('round-trips the whole code page', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i).filter((b) => b !== 0x98);
    expect(bytes(encodeCp1251(decodeCp1251(all)))).toEqual(bytes(all));
  });
});
