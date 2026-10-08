import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { empCalc, mpinRows, payDraft, payrollPaymentOrders, type HrContract } from '@wise/core';
import { contractHtml, diHtml, extHtml, leaveHtml } from './docs';
import { h, printDoc } from './html';
import { mpinXlsx, mpinXlsxRows } from './mpin-export';
import { ordersSummaryHtml, ppPagesHtml } from './orders-html';
import { m4Rows, recapHtml, slipHtml, stazYMD, yearRows } from './slip';

const firm = { name: 'Тест ДООЕЛ', edb: '4030000000001', embs: '1234567', bankAccount: '300000000000123', bankName: 'Комерцијална', activity: '69.20', address: 'Ул. 1', city: 'Скопје', signer: 'Петар Петров', signerRole: 'Управител', email: '' };
const run = payDraft('2026-04', [{ id: 'a', no: '1', name: 'Ана <Петрова>', embg: '0101990450001', netBase: 30000, start: '2020-03-01' }, { id: 'b', no: '2', name: 'Борис', netBase: 22567 }]);

describe('payslip and recap', () => {
  it('prints the net, the rates of the run and escapes names', () => {
    const s = slipHtml(run, run.emps[0]!, firm, { start: '2020-03-01', position: 'Сметководител' }, 'Ивана');
    const c = empCalc(run.emps[0]!, run.params);
    expect(s).toContain('ПРЕСМЕТКА НА ПЛАТА');
    expect(s).toContain('април 2026');
    expect(s).toContain('Ана &lt;Петрова&gt;');
    expect(s).toContain(`ПИО ${String(run.params.pio).replace('.', ',')}%`);
    expect(s).toContain('MK4030000000001');
    expect(s).toMatch(new RegExp(`НЕТО ЗА ИСПЛАТА</span><b style="font-size:20px">${c.T.net.toLocaleString('de-DE').replace(/\./g, '\\.')},00`));
  });

  it('recap header uses the run rates (FIX #1: no 18.8 / 1.2 fallbacks)', () => {
    const r = recapHtml(run, firm);
    expect(r).toContain('ПИО 19,9%');
    expect(r).toContain('Вработување 0,1%');
    expect(r).not.toContain('18,8');
  });

  it('seniority in years, months, days', () => {
    expect(stazYMD({ start: '2020-03-01' }, '2026-04')).toEqual({ y: 6, m: 2, d: 0 });
    expect(stazYMD({ start: '2020-03-15', stazPrev: 1.5 }, '2026-04')).toEqual({ y: 7, m: 7, d: 16 });
  });

  it('annual and М4 rows', () => {
    const Y = yearRows([run]);
    expect(Y[0]!.m['04']!.n).toBe(empCalc(run.emps[0]!, run.params).T.net);
    const M = m4Rows([run, { ...run, month: '2026-05' }]);
    expect(M[0]!.months).toEqual(['2026-04', '2026-05']);
  });
});

describe('MPIN Excel', () => {
  it('has the legacy columns and a totals row', () => {
    const R = mpinRows(run.emps, run.params);
    const rows = mpinXlsxRows(R);
    expect(rows[0]![13]).toBe('Нето плата');
    expect(rows.at(-1)![13]).toBe(R[0]!.net + R[1]!.net);
    const wb = XLSX.read(mpinXlsx(R, firm, '2026-04'), { type: 'array' });
    expect(wb.SheetNames[0]).toBe('МПИН 2026-04');
  });
});

describe('HR documents', () => {
  const c: Partial<HrContract> = { type: 'opr', no: '5/2026', signDate: '2026-03-01', start: '2026-03-01', end: '2026-08-31', position: 'Книговодител', hours: 40, gross: 45000, net: 30000, leave: 21, notice: 1, rep: 'Петар', repRole: 'Управител' };
  it('contract with control code; draft watermark only when unsaved', () => {
    const s = contractHtml(firm, { name: 'Ана', embg: '0101990450001' }, c, { code: 'AAAA-BBBB-CCCC' });
    expect(s).toContain('ДОГОВОР ЗА ВРАБОТУВАЊЕ');
    expect(s).toContain('31.08.2026');
    expect(s).toContain('AAAA-BBBB-CCCC');
    expect(s).not.toContain('НАЦРТ');
    expect(contractHtml(firm, { name: 'Ана' }, c, { draft: true })).toContain('НАЦРТ');
  });
  it('annex, decision, disciplinary and leave documents', () => {
    expect(extHtml(firm, { name: 'Ана' }, c, { kind: 'ext', doc: 'annex', date: '2026-08-20', end: '2027-02-28', no: '9/2026' })).toContain('до 28.02.2027');
    expect(extHtml(firm, { name: 'Ана' }, c, { kind: 'transform', doc: 'odluka', date: '2026-08-20' })).toContain('О Д Л У К А');
    expect(diHtml(firm, { name: 'Ана' }, { kind: 'otkaz', date: '2026-05-04', ground: 'delovni', notice: 1, last: '2026-06-04' }, 'X')).toContain('деловни причини');
    expect(leaveHtml(firm, { name: 'Ана' }, { no: '3/2026', date: '2026-07-01', start: '2026-07-06', end: '2026-07-17', days: 10 }, 'X')).toContain('10 работни дена');
  });
});

describe('payment orders', () => {
  it('summary lists missing data and slips are 3 per page', () => {
    const r = payrollPaymentOrders(run, run.params, [], { ...firm, bankAccount: '' }, {}, '2026-05-05');
    const s = ordersSummaryHtml(firm, '2026-04', r.orders, r.missing);
    expect(s).toContain('Недостасуваат податоци');
    expect(s).toContain('ПП50');
    const pages = ppPagesHtml(r.orders);
    expect((pages.match(/class="ppslip"/g) ?? []).length).toBe(r.orders.length);
    expect((pages.match(/page-break-before/g) ?? []).length).toBe(Math.ceil(r.orders.length / 3) - 1);
  });
  it('print document wraps the body', () => {
    expect(printDoc('T', '<b>x</b>')).toContain('<div class="pdfdoc"><b>x</b></div>');
    expect(h('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
  });
});
