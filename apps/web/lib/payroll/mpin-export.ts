/** MPIN Excel (legacy ACT `mpinXlsx` 7790): one row per employee + totals, header with firm and month. */
import * as XLSX from 'xlsx';
import type { MpinRow } from '@wise/core';

export const MPIN_XLSX_HEAD = ['Бр.', 'Име и презиме', 'ЕМБГ', 'Часови', 'Бруто плата', 'Основица за придонеси', 'ПИО', 'Здравство', 'Доп. здравство', 'Вработување', 'Даночно ослободување', 'Основица за данок', 'Персонален данок', 'Нето плата', 'Сметка'];

export function mpinXlsxRows(R: readonly MpinRow[]): (string | number)[][] {
  const T = (k: keyof MpinRow) => R.reduce((s, r) => s + (+r[k]! || 0), 0);
  return [
    MPIN_XLSX_HEAD,
    ...R.map((r) => [r.no ?? '', r.name, r.embg, r.hours, r.gross, r.base, r.pio, r.zdr, r.dop, r.vrab, r.ex, r.taxBase, r.tax, r.net, r.bankAcc]),
    ['', 'ВКУПНО', '', T('hours'), T('gross'), T('base'), T('pio'), T('zdr'), T('dop'), T('vrab'), T('ex'), T('taxBase'), T('tax'), T('net'), ''],
  ];
}

export function mpinXlsx(R: readonly MpinRow[], firm: { name: string; edb: string }, month: string): Uint8Array {
  const rows = mpinXlsxRows(R);
  const ws = XLSX.utils.aoa_to_sheet([[`${firm.name} · ЕДБ ${firm.edb} · МПИН за ${month}`], [], ...rows]);
  ws['!cols'] = MPIN_XLSX_HEAD.map((_, i) => ({ wch: i === 1 ? 28 : i === 2 ? 15 : 13 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'МПИН ' + month);
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
}
