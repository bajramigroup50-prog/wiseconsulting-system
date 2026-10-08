/**
 * Golden tests: bank statement parsers vs the legacy parsers (final patched versions) in Node `vm`.
 * Amounts: legacy works in denars (floats), the port in integer cents — compared as cents.
 * Every deliberate difference is asserted explicitly and labelled FIX.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseBankCsv, parseBankTable, parseBankXml, parseKB, parseMT940, parseStatementFile, detectStatementFormat, splitCsv,
  type Statement, type StatementLine,
} from '../../../src/bank-parsers';
import { loadLegacy, plain } from './legacy';

const fx = (n: string) => fileURLToPath(new URL('./fixtures/' + n, import.meta.url));
const text = (n: string) => readFileSync(fx(n), 'utf8');
const bytes = (n: string) => new Uint8Array(readFileSync(fx(n)));
const c = (x: number | null | undefined) => (x == null ? null : Math.round(Math.round(x * 100) / 100 * 100) || 0);

/** cp1251 encoder built from Node's own decoder (independent of the port's table). */
function toCp1251(s: string): Uint8Array {
  const dec = new TextDecoder('windows-1251');
  const map = new Map<string, number>();
  for (let b = 0; b < 256; b++) map.set(dec.decode(new Uint8Array([b])), b);
  return new Uint8Array([...s].map((ch) => { const b = map.get(ch); if (b == null) throw new Error('not cp1251: ' + ch); return b; }));
}

const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/* ------------------------------------------------------------------ MT940 */

type LegacyMt = { no: string; cur: string; d: number; c: number; open: number | null; close: number | null; items: { date: string; amount: number; desc: string; name?: string }[] };
const legacyMT940 = (txt: string): LegacyMt[] => { const L = loadLegacy(); return plain(L.run<LegacyMt[]>(`parseMT940(${JSON.stringify(txt)})`)); };

describe('parseMT940 vs legacy (4763 → 12558 → 12593 → 12720)', () => {
  for (const variant of ['lf', 'crlf', 'cp1251'] as const) {
    it(`single statement (${variant}) — lines, balances, numbers, names`, () => {
      const src = text('mt940-single.sta').replace(/\r\n/g, '\n');
      const input = variant === 'lf' ? src : variant === 'crlf' ? src.replace(/\n/g, '\r\n') : toCp1251(src);
      const mine = parseMT940(input);
      const leg = legacyMT940(src);
      expect(mine).toHaveLength(leg.length);
      expect(mine).toHaveLength(1);
      const [m, l] = [mine[0]!, leg[0]!];
      expect(m.no).toBe(l.no);
      expect(m.no).toBe('105'); // "2026105" → 105
      expect(m.currency).toBe(l.cur);
      expect(m.opening).toBe(c(l.open));
      expect(m.closing).toBe(c(l.close));
      expect(m.debit).toBe(c(l.d));
      expect(m.credit).toBe(c(l.c));
      expect(m.account).toBe('270000012345678');
      expect(m.lines.map((x) => ({ date: x.date, amount: x.amount, desc: x.desc, name: x.counterparty })))
        .toEqual(l.items.map((x) => ({ date: x.date, amount: c(x.amount), desc: x.desc, name: x.name || '' })));
      // sanity on content
      expect(m.lines[0]).toMatchObject({ amount: 5900000, counterparty: 'ABC TRADE DOOEL SKOPJE', purpose: 'Uplata po faktura br. 45/2026' });
      expect(m.lines[1]).toMatchObject({ amount: -1250000, counterparty: 'BETA DOO', iban: '300000000299999', ref: '0012345' });
      expect(m.lines[3]!.desc).toBe('Налог бр. NONREF//2603150001236');
      expect(m.lines[5]).toMatchObject({ amount: 10000, counterparty: 'ACME GMBH', purpose: 'STORNO INV 2026-77' }); // RD = reversal of debit → +
      expect(m.opening! + m.credit! - m.debit!).toBe(m.closing);
    });
  }

  it('multi-statement file: FIX #1 balances per statement, names per item, whole :86: field', () => {
    const src = text('mt940-multi.sta');
    const mine = parseMT940(src);
    const leg = legacyMT940(src);
    expect(mine.map((s) => s.no)).toEqual(leg.map((s) => s.no));
    expect(mine.map((s) => s.lines.map((x) => [x.date, x.amount]))).toEqual(leg.map((s) => s.items.map((x) => [x.date, c(x.amount)])));
    // FIX: legacy gave every statement the first statement's :60F:/:62F:
    expect(leg.map((s) => [c(s.open), c(s.close)])).toEqual([[100000, 195000], [100000, 195000]]);
    expect(mine.map((s) => [s.opening, s.closing])).toEqual([[100000, 195000], [195000, 245000]]);
    // FIX: legacy read only the first line of a multi-line :86:, so the ?32 name was lost
    expect(leg[0]!.items[0]).toMatchObject({ desc: 'INV EX-3/2026 ACME GMBH' });
    expect(leg[0]!.items[0]!.name).toBeUndefined();
    expect(mine[0]!.lines[0]).toMatchObject({ counterparty: 'ACME GMBH', desc: 'ACME GMBH – INV EX-3/2026' });
    // FIX: a skipped :61: (no amount) shifted legacy's running name index onto the next statement's line
    expect(leg[1]!.items[0]).toMatchObject({ name: 'SKIPPED LINE NAME' });
    expect(mine[1]!.lines[0]).toMatchObject({ counterparty: 'ACME GMBH', desc: 'ACME GMBH – part payment EX-4/2026' });
    // unchanged lines stay equal
    expect(mine[0]!.lines[1]!.desc).toBe(leg[0]!.items[1]!.desc);
  });
});

/* ------------------------------------------------------------------ XML */

type LegacyXmlSt = Record<string, any> & { items: Record<string, any>[] };
const legacyXml = (txt: string): LegacyXmlSt[] | null => { const L = loadLegacy(); return plain(L.run<LegacyXmlSt[] | null>(`parseBankXml(${JSON.stringify(txt)})`)); };
const fromLegacyXmlLine = (x: Record<string, any>): StatementLine => drop({
  date: x.date, valDate: x.valDate || undefined, amount: c(x.amount)!, amountMkd: c(x.mkd)!, counterparty: x.name, iban: x.cpAcct || undefined,
  ref: x.ref, purpose: x.purpose, desc: x.desc, osnov: x.osnov || undefined, nalog: x.nalog || undefined, nominal: c(x.nominal)!, fee: c(x.fee)!,
});

describe('parseBankXml vs legacy (12605–12626)', () => {
  it('Halk RacunPrivredaIzvod (MKD, UTF-8 and cp1251)', () => {
    const src = text('halk-mkd.xml');
    const leg = legacyXml(src)!;
    for (const input of [src, toCp1251(src.replace('encoding="utf-8"', 'encoding="windows-1251"'))]) {
      const mine = parseBankXml(input)!;
      expect(mine).toHaveLength(1);
      const [m, l] = [mine[0]!, leg[0]!];
      expect(m.lines).toEqual(l.items.map(fromLegacyXmlLine));
      expect(drop({ format: m.format, account: m.account, iban: m.iban, owner: m.owner, no: m.no, date: m.date, currency: m.currency, opening: m.opening, closing: m.closing, debit: m.debit, credit: m.credit }))
        .toEqual(drop({ format: 'halk-xml', account: l.acct, iban: l.iban, owner: l.owner, no: l.no, date: l.date, currency: l.cur, opening: c(l.open), closing: c(l.close), debit: c(l.d), credit: c(l.c) }));
      expect(m.no).toBe('46');
      expect(m.lines).toHaveLength(4); // zero line skipped
      expect(m.lines[3]!.counterparty).toBe('Гама Комерц & Ко');
      expect(m.lines[3]!.purpose).toBe('Уплата\nаванс – Уплата аванс'); // &#10; kept, literal newline normalised
      expect(m.opening! + m.credit! - m.debit!).toBe(m.closing);
    }
  });

  it('Halk FX inflow with foreign-bank fee (nominal > credited)', () => {
    const src = text('halk-eur.xml');
    const [m] = parseBankXml(src)!;
    const [l] = legacyXml(src)!;
    expect(m!.lines).toEqual(l!.items.map(fromLegacyXmlLine));
    expect(m!.lines[0]).toMatchObject({ amount: 98000, amountMkd: 6027000, nominal: 100000, fee: 2000, valDate: '2026-03-17', date: '2026-03-18' });
    expect(m!.date).toBe(l!.date);
  });

  it('ISO 20022 camt.053 (namespaces, Pty/Nm, CDATA, entities, AddtlNtryInf-only entry)', () => {
    const src = text('camt053.xml');
    const mine = parseBankXml(src)!;
    const leg = legacyXml(src)!;
    expect(mine).toHaveLength(1);
    const [m, l] = [mine[0]!, leg[0]!];
    expect(m.lines).toEqual(l.items.map(fromLegacyXmlLine));
    expect({ format: m.format, no: m.no, iban: m.iban, account: m.account, currency: m.currency, opening: m.opening, closing: m.closing })
      .toEqual({ format: 'camt.053', no: l.no, iban: l.iban, account: l.acct, currency: l.cur, opening: c(l.open), closing: c(l.close) });
    expect(m.lines.map((x) => x.amount)).toEqual([2200000, -450000, -4200]);
    expect(m.lines[1]!.purpose).toBe('Телеком месечна сметка 03/2026 <интернет>');
    expect(m.lines[0]!.counterparty).toBe('ГАМА КОМЕРЦ & КО');
    expect(m.opening! + m.lines.reduce((s, x) => s + x.amount, 0)).toBe(m.closing);
  });

  it('malformed XML → null (legacy parsererror → null)', () => {
    const bad = '<RacunPrivredaIzvod><Zaglavlje></RacunPrivredaIzvod>';
    expect(parseBankXml(bad)).toBeNull();
    expect(legacyXml(bad)).toBeNull();
  });
});

/* ------------------------------------------------------------------ KB */

type LegacyKB = { fmt: string; items: Record<string, any>[]; open: number | null; close: number | null; no: string; cur: string; acct: string; date?: string };
const legacyKB = (txt: string): LegacyKB | null => { const L = loadLegacy(); return plain(L.run<LegacyKB | null>(`parseKB(${JSON.stringify(txt)})`)); };

describe('parseKB vs legacy (12669–12676)', () => {
  it('item file (cp1251 bytes) — FIX #12: statement number from the first line, per-line stmtNo', () => {
    const src = text('kb-stavki.300');
    const mine = parseKB(toCp1251(src))!;
    const leg = legacyKB(src)!;
    expect(mine.lines.map((x) => drop({ ...x, stmtNo: undefined }))).toEqual(leg.items.map((x) => drop({
      date: x.bookDate, valDate: x.date, amount: c(x.amount)!, amountMkd: c(x.mkd)!, counterparty: '', iban: x.cpAcct || undefined, ref: x.ref, purpose: '', desc: x.desc, nominal: 0, fee: 0,
    })));
    expect(mine.account).toBe(leg.acct);
    expect(mine.currency).toBe(leg.cur);
    expect(leg.no).toBe('47'); // legacy: last line wins
    expect(mine.no).toBe('46'); // FIX
    expect(mine.lines.map((x) => x.stmtNo)).toEqual(['46', '46', '47']);
    expect(mine.lines[0]).toMatchObject({ amount: 1200000, ref: '0000012345', iban: '300000000299999', desc: 'Прилив · реф. 12345' });
  });

  it('leading record (balances only)', () => {
    const src = text('kb-vodecki.300');
    const mine = parseKB(src)!;
    const leg = legacyKB(src)!;
    expect(mine.lines).toEqual([]);
    expect([mine.opening, mine.closing, mine.date, mine.no]).toEqual([c(leg.open), c(leg.close), leg.date, leg.no]);
  });

  it('EUR account: currency amounts + denar counter-value', () => {
    const src = text('kb-eur.300');
    const mine = parseKB(src)!;
    const leg = legacyKB(src)!;
    expect(mine.lines.map((x) => [x.amount, x.amountMkd, x.ref, x.desc])).toEqual(leg.items.map((x) => [c(x.amount), c(x.mkd), x.ref, x.desc]));
    expect([mine.opening, mine.closing]).toEqual([c(leg.open), c(leg.close)]);
    expect(mine.lines[0]).toMatchObject({ amount: 50000, amountMkd: 3077500 });
  });

  it('no KB lines → null', () => {
    expect(parseKB('hello')).toBeNull();
    expect(legacyKB('hello')).toBeNull();
  });
});

/* ------------------------------------------------------------------ tables */

describe('parseBankTable / CSV vs legacy importRows (4745–4762)', () => {
  async function legacyImport(rows: unknown[][]) {
    const L = loadLegacy();
    L.run(`S.saved=[];S.firm={id:'f1',izv:{}};saveBank=async(b)=>{S.saved.push(b);return true};`);
    L.S.rows = rows;
    const ok = await L.run<Promise<boolean>>('importRows(S.rows)');
    return { ok, saved: plain(L.S.saved) as Record<string, any>[], izvSal: plain(L.S.firm.izvSal) as Record<string, any> | undefined, izvNos: plain(L.S.izvNos) as Record<string, string> };
  }

  it('Macedonian bank CSV: in/out columns, name+purpose, code, reference, number, balances', async () => {
    const src = text('table.csv');
    const rows = splitCsv(src);
    const leg = await legacyImport(rows);
    expect(leg.ok).toBe(true);
    const [st] = parseBankCsv(new TextEncoder().encode(src))!;
    expect(st!.lines.map((x) => drop({ date: x.date, amount: x.amount, desc: x.desc, name: x.counterparty || undefined, osnov: x.osnov, bref: x.ref || undefined })))
      .toEqual(leg.saved.map((b) => drop({ date: b.date, amount: c(b.amount), desc: b.desc, name: b.name, osnov: b.osnov, bref: b.bref })));
    expect(st!.no).toBe('48');
    expect(leg.izvNos).toEqual({ '2026-03-20': '48' });
    expect([st!.opening, st!.closing]).toEqual([c(leg.izvSal!['2026-03-20'].o), c(leg.izvSal!['2026-03-20'].c)]);
    expect(st!.lines).toHaveLength(6);
  });

  it('legacy CSV splitting equals splitCsv for unquoted files; FIX: quoted delimiters', () => {
    const src = text('table.csv');
    const legacySplit = (txt: string) => { const lines = txt.split(/\r?\n/).filter((l) => l.trim()); const delim = [';', '\t', ',', '|'].sort((a, b) => (lines[0] || '').split(b).length - (lines[0] || '').split(a).length)[0]!; return lines.map((l) => l.split(delim).map((x) => x.replace(/^"|"$/g, '').trim())); };
    expect(splitCsv(src)).toEqual(legacySplit(src));
    const q = 'Датум,Опис,Износ\n01.03.2026,"Уплата, аванс","1.234,56"';
    expect(splitCsv(q)[1]).toEqual(['01.03.2026', 'Уплата, аванс', '1.234,56']);
    expect(legacySplit(q)[1]).toEqual(['01.03.2026', 'Уплата', 'аванс', '1.234', '56']); // legacy broke the row
    expect(parseBankTable(splitCsv(q))!.lines[0]).toMatchObject({ amount: 123456, desc: 'Уплата, аванс' });
  });

  it('signed amount column and Excel serial dates (FIX: UTC)', async () => {
    const rows = [['Date', 'Description', 'Amount'], [46096, 'Invoice 5', '1,250.00'], [46097, 'Fee', -12.5], ['x', 'skip', 1]];
    const st = parseBankTable(rows)!;
    expect(st.lines.map((x) => [x.date, x.amount])).toEqual([['2026-03-15', 125000], ['2026-03-16', -1250]]);
    const leg = await legacyImport(rows);
    expect(leg.saved.map((b) => c(b.amount))).toEqual([125000, -1250]);
  });
});

/* ------------------------------------------------------------------ dispatch */

describe('detectStatementFormat / parseStatementFile (importBankFile chain)', () => {
  it('routes by extension and content like legacy', () => {
    expect(detectStatementFormat(bytes('kb-stavki.300'), 'Izvod_stavki_123.300')).toBe('kb');
    expect(detectStatementFormat(bytes('mt940-single.sta'), 'izvod.940')).toBe('mt940'); // .940 also tried as KB first
    expect(detectStatementFormat(bytes('halk-mkd.xml'), 'izvod.xml')).toBe('halk-xml');
    expect(detectStatementFormat(bytes('halk-mkd.xml'), 'izvod.xls')).toBe('halk-xml'); // Halk ".xls" that is XML
    expect(detectStatementFormat(bytes('camt053.xml'), 'camt.xml')).toBe('camt.053');
    expect(detectStatementFormat(bytes('mt940-single.sta'), 'export.txt')).toBe('mt940');
    expect(detectStatementFormat(bytes('table.csv'), 'izvod.csv')).toBe('table');
    expect(detectStatementFormat(new Uint8Array([1, 2]), 'izvod.xlsx')).toBe('excel');
    expect(detectStatementFormat(new Uint8Array([1, 2]), 'izvod.pdf')).toBe('ai');
  });
  it('parses each fixture end to end', () => {
    const n = (s: Statement[] | null) => s?.reduce((a, x) => a + x.lines.length, 0);
    expect(n(parseStatementFile(bytes('mt940-single.sta'), 'a.sta'))).toBe(6);
    expect(n(parseStatementFile(bytes('halk-mkd.xml'), 'a.xml'))).toBe(4);
    expect(n(parseStatementFile(bytes('camt053.xml'), 'a.xml'))).toBe(3);
    expect(n(parseStatementFile(bytes('kb-stavki.300'), 'a.300'))).toBe(3);
    expect(n(parseStatementFile(bytes('table.csv'), 'a.csv'))).toBe(6);
    expect(parseStatementFile(bytes('table.csv'), 'a.pdf')).toBeNull();
  });
});
