/**
 * Import audit (docs/IMPORT-AUDIT.md): synthetic statements of the Macedonian banks (PDF with a real text layer
 * rendered by Chromium, Excel, CSV — `gen-fixtures.mjs`), invoices and Excel master data, each through the exact
 * production path:
 *  - bank PDF without AI: pdfjs (`lib/pdf-text`) → `statementFromPdfItems` (worker `freeRead`) → `statementFromRead`
 *    (the /banka import of a read);
 *  - bank PDF / Excel in the converter: `readPdfGrid` (bank table) / sheet → target `prepare` → `convApply` →
 *    `convCheck` (the importer's own parser) → the downloaded grid read by the /banka Excel import;
 *  - bank Excel / CSV on /banka: `readBankTable` / `parseStatementFile`;
 *  - invoice PDF without AI: `invoiceFromPdf`;
 *  - partners / articles / firms / payroll Excel: converter targets checked with `impAuto` / `fimpParse` / `plxParse`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { statementFromRead } from '@wise/core/ai/bank';
import { parseStatementFile, readBankTable } from '@wise/core/bank-parsers';
import { convApply, convAuto, convCheck, convHeaderRowFor, convTarget, type ConvTarget } from '@wise/core/convert/index';
import { fimpParse } from '@wise/core/firms/firmimp';
import { statementFromPdfItems } from '@wise/core/noai/bank';
import { bankPdfGrid } from '@wise/core/noai/bank-grid';
import { pdfLines } from '@wise/core/noai/pdf-lines';
import { invoiceFromPdf } from '@wise/core/noai/purchase';
import { plxParse } from '@wise/core/payroll/xlsx-import';
import { pdfTextItems } from '@/lib/pdf-text';

const F = join(__dirname, 'fixtures');
type Line = { date: string; amount: number; name: string; ref: string; code: string };
type Exp = { n: number; no: string; account: string; date?: string; opening: number; closing: number; debit: number; credit: number; lines: Line[]; nameIn?: 'desc' };
const E = JSON.parse(readFileSync(join(F, 'expected.json'), 'utf8')) as Record<string, Exp & Record<string, unknown>>;
const BANKS = ['kb', 'stb', 'nlb', 'halk', 'spk', 'pcb', 'uni', 'silk', 'ttk', 'ckb'];
const bytes = (f: string) => new Uint8Array(readFileSync(join(F, f)));
const sheet = (f: string): unknown[][] => {
  const wb = XLSX.read(bytes(f), { type: 'array', cellDates: true });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: '' });
};
const items = async (id: string) => pdfTextItems(bytes(id + '.pdf'));

/** The converter as the screen runs it: target's own header / mapping, header values, check with the importer. */
function convert(t: ConvTarget, raw: unknown[][]) {
  const hi = convHeaderRowFor(t, raw);
  const prep = t.prepare?.(raw, hi) ?? null;
  const grid = prep?.grid ?? raw;
  const map = prep?.map ?? convAuto(t, grid[hi] ?? []);
  const res = convApply(t, grid.slice(hi + 1), map, { firstRow: hi + 2, hdr: prep?.hdr ?? {}, ...(prep ? { meta: prep.meta, rowNos: prep.rowNos } : {}) });
  return { prep, map, res, chk: convCheck(t, res) };
}

describe('bank statement PDF without AI (worker free reader → /banka)', () => {
  for (const id of BANKS) {
    it(`${id}: every transaction, exact amounts, statement data, opening + movements = closing`, async () => {
      const e = E[id]!;
      const r = statementFromPdfItems(await items(id))!;
      expect(r.warnings ?? []).toEqual([]);
      expect(r.balanced).toBe(true);
      expect({ no: r.number, account: r.account }).toEqual({ no: e.no, account: e.account });
      expect(Math.round(Number(r.openingBalance) * 100)).toBe(e.opening);
      expect(Math.round(Number(r.closingBalance) * 100)).toBe(e.closing);
      expect(r.items!.map((x) => [x.date, Math.round(Number(x.amount) * 100)])).toEqual(e.lines.map((l) => [l.date, l.amount]));
      r.items!.forEach((x, i) => {
        const l = e.lines[i]!;
        if (e.nameIn === 'desc') expect(x.desc).toContain(l.name.split(' ')[0]);
        else expect(x.name).toBe(l.name);
      });
      // the bank screen maps the read like an AI read
      const st = statementFromRead(r)!;
      expect(st.lines.map((l) => l.amount)).toEqual(e.lines.map((l) => l.amount));
    });
  }
});

describe('bank statement in the converter (PDF / Excel → Банкарски извод → /banka)', () => {
  const t = convTarget('bank')!;
  const cases: [string, string, () => Promise<unknown[][]>][] = [
    ...BANKS.map((id): [string, string, () => Promise<unknown[][]>] => [id, 'PDF', async () => bankPdfGrid(await items(id))!.grid]),
    ...['kb', 'stb', 'halk'].map((id): [string, string, () => Promise<unknown[][]>] => [id, 'Excel', async () => sheet(id + '.xlsx')]),
  ];
  for (const [id, kind, src] of cases) {
    it(`${id} ${kind}: mapped, checked by the importer, balances reconcile`, async () => {
      const e = E[id]!;
      const { prep, map, res, chk } = convert(t, await src());
      expect(prep).not.toBeNull();
      expect(map.in != null || map.out != null || map.amount != null).toBe(true);
      expect(res.blocked).toBe(false);
      expect(res.errors).toEqual([]);
      expect(chk.error).toBeUndefined();
      expect(chk.diff).toEqual([]);
      expect(chk.rows.map((r) => Math.round(Number(r.amount) * 100))).toEqual(e.lines.map((l) => l.amount));
      expect(res.notes).toEqual([expect.objectContaining({ ok: true })]);
      // the downloaded file on /banka: same lines, number, account and balances
      const R = readBankTable(res.grid as unknown[][]);
      expect(R.warnings).toEqual([]);
      expect({ no: R.st!.no, account: R.st!.account, opening: R.st!.opening, closing: R.st!.closing }).toEqual({ no: e.no, account: e.account, opening: e.opening, closing: e.closing });
    });
  }

  it('Халк (PDF converted to Excel): two header rows, „задолжува одобрува“ in one cell, „0.00 666“ split, date from the header', () => {
    const { prep, map, res } = convert(t, sheet('halk.xlsx'));
    expect(prep!.hi).toBe(4);
    expect(prep!.grid[4]).toEqual(expect.arrayContaining([
      'Назив и седиште на примачот - налогодавач број на сметката (назив)', 'ИЗНОС задолжува одобрува (задолжување)', 'ИЗНОС задолжува одобрува (одобрување)',
      'Повикување на број (задолжување и одобрување)']));
    expect(map.date).toBeUndefined();
    expect(prep!.hdr).toEqual({ date: '05.03.2026' });
    expect(res.recs[0]).toMatchObject({ date: '05.03.2026', name: 'ГАМА КОМЕРЦ ДООЕЛ Скопје', acc: '300000000211234', in: 25000, osnov: '200', ref: '0047-2026' });
    expect(res.recs[1]).toMatchObject({ out: 2360, osnov: '930' });
  });
});

describe('bank statement Excel / CSV on /banka', () => {
  for (const id of ['kb', 'stb', 'halk']) {
    it(`${id} Excel`, () => {
      const e = E[id]!;
      const R = readBankTable(sheet(id + '.xlsx'));
      expect(R.warnings).toEqual([]);
      expect(R.st!.lines.map((l) => [l.date, l.amount])).toEqual(e.lines.map((l) => [l.date, l.amount]));
      expect([R.st!.no, R.st!.account, R.st!.opening, R.st!.closing]).toEqual([e.no, e.account, e.opening, e.closing]);
    });
  }
  for (const id of ['kb', 'pcb']) {
    it(`${id} CSV`, () => {
      const S = parseStatementFile(bytes(id + '.csv'), id + '.csv')!;
      expect(S[0]!.lines.map((l) => l.amount)).toEqual(E[id]!.lines.map((l) => l.amount));
    });
  }
  it('clear messages: which heading / row failed', () => {
    expect(readBankTable([['Нешто'], ['1', '2']]).error).toMatch(/редот со насловите/);
    expect(readBankTable([['Извод бр. 5'], ['Налогодавач', 'Цел', 'Износ'], ['АЛФА', 'Уплата', '100,00']]).error).toMatch(/нема колона „Датум“/);
    const R = readBankTable([['Датум', 'Опис', 'Должи', 'Побарува'], ['02.03.2026', 'Уплата', '', '100,00'], ['31.02.2026', 'Грешен датум', '5,00', ''], ['03.03.2026', 'Лош износ', '12,5x', '']]);
    expect(R.st!.lines).toHaveLength(1);
    expect(R.warnings).toEqual([
      'Ред 3: „31.02.2026“ во колоната „Датум“ не е датум – ставката е прескокната.',
      'Ред 4: колона „Должи“: „12,5x“ не е износ – ставката е прескокната.',
    ]);
    const B = readBankTable([['Претходна состојба: 100,00'], ['Датум', 'Опис', 'Прилив'], ['02.03.2026', 'Уплата', '50,00'], ['Нова состојба: 200,00']]);
    expect(B.warnings[0]).toMatch(/Салдата не се совпаѓаат: претходна состојба 100,00 \+ промет 50,00 = 150,00, а новата состојба во изводот е 200,00 \(разлика 50,00\)/);
  });
});

describe('invoice PDF without AI', () => {
  it('VAT recapitulation 18 / 10 / 5 / 0, number, dates, supplier ЕДБ', async () => {
    const e = E['inv-recap'] as unknown as { number: string; date: string; dueDate: string; edb: string; groups: { rate: number; base: number; vat: number }[]; total: number };
    const inv = invoiceFromPdf(pdfLines(await items('inv-recap')), { ownEdb: '4030999000111' })!;
    expect(inv).toMatchObject({ number: e.number, date: e.date, dueDate: e.dueDate, supplierEdb: e.edb, total: e.total });
    expect(inv.groups!.map((g) => ({ rate: g.rate, base: g.base, vat: g.vat }))).toEqual(e.groups);
  });
  it('dot-format amounts („11,800.00“), ISO date', async () => {
    const e = E['inv-dot'] as unknown as { number: string; date: string; edb: string; groups: { rate: number; base: number; vat: number }[]; total: number };
    const inv = invoiceFromPdf(pdfLines(await items('inv-dot')))!;
    expect(inv).toMatchObject({ number: e.number, date: e.date, supplierEdb: e.edb, total: e.total });
    expect(inv.groups!.map((g) => ({ rate: g.rate, base: g.base, vat: g.vat }))).toEqual(e.groups);
  });
});

describe('master data from Excel (converter → importer parsers, and the direct imports)', () => {
  it('partners: ЕДБ with / without MK, code, account', () => {
    const { res, chk } = convert(convTarget('imp:partners')!, sheet('partners.xlsx'));
    expect(chk.error).toBeUndefined();
    expect(chk.diff).toEqual([]);
    expect(res.recs.map((r) => [r.code, r.name, r.edb])).toEqual([['1029', 'МАЈАНЦЕ ДООЕЛ', 'MK4030999000444'], ['1030', 'ГАМА КОМЕРЦ ДООЕЛ', '4030999000555']]);
  });
  it('articles: the sales price is not taken from the purchase-price column; VAT 18 / 10 / 5', () => {
    const { res, chk, map } = convert(convTarget('imp:items')!, sheet('items.xlsx'));
    expect(chk.error).toBeUndefined();
    expect(chk.diff).toEqual([]);
    expect(map.price).toBe(5);
    expect(res.recs.map((r) => [r.code, r.price, r.rate])).toEqual([['A-001', 299, 18], ['A-002', 1590, 10], ['A-003', 60, 5]]);
  });
  it('firms: VAT payer / period columns („да“, „месечно“, „DA“, „3M“)', () => {
    const raw = sheet('firms.xlsx');
    const { res, chk } = convert(convTarget('firms')!, raw);
    expect(chk.error).toBeUndefined();
    expect(chk.diff).toEqual([]);
    expect(res.recs.map((r) => [r.name, r.ddv ?? '', r.per ?? ''])).toEqual([['АЛФА ДООЕЛ', 'да', 'месечно'], ['БЕТА ДОО', 'не', ''], ['ГАМА ТП', 'да', 'тромесечно']]);
    const P = fimpParse(raw);
    expect('error' in P ? P.error : P.L.map((f) => [f.edb, f.ddv, f.per])).toEqual([['4030999000666', true, 'month'], ['4030999000777', false, undefined], ['4030999000888', true, 'quarter']]);
  });
  it('payroll: ЕМБГ, net / gross in MK format, hours', () => {
    const raw = sheet('payroll.xlsx');
    const P = plxParse(raw);
    if ('error' in P) throw new Error(P.error);
    expect(P.rows.map((r) => [r.embg, r.net ?? null, r.gross ?? null, r.reg ?? null, r.hours.bol ?? null, r.hours.odm ?? null]))
      .toEqual([['0101990450012', 34500, null, 160, 0, 8], ['1505985455019', null, 52000, 168, 8, 0]]);
    const { chk } = convert(convTarget('pay')!, raw);
    expect(chk.error).toBeUndefined();
    expect(chk.diff).toEqual([]);
  });
});
