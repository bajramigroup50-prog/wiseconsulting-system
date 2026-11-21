/** „⬇ Excel“ of „💧 Паричен тек – прогноза“: sheet „По ден“ (every day), „По недела“, „Ставки“ and „Предупредувања“. */
import * as XLSX from 'xlsx';
import { klAllowedViews, type KlConfig } from '@wise/core/office';
import { CF_KIND } from '@wise/core/cashflow';
import { firmAllowed } from '@wise/core';
import { getUser } from '@/lib/auth';
import { cfOptsFrom, cfSettings, loadCashflow } from '@/lib/cashflow';
import { currentFirm } from '@/lib/context';
import { viewAllowed } from '@/lib/nav';
import { todayIso } from '@/lib/stock';
import { cfAccess, CF_VIEW } from '../guard';

const dmy = (d: string) => d.split('-').reverse().join('.');

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return new Response('Unauthorized', { status: 401 });
  const firm = await currentFirm(u);
  if (!firm) return new Response('Изберете фирма.', { status: 400 });
  const on = klAllowedViews((firm.settings as { kl?: KlConfig }).kl, firm.mods).includes(CF_VIEW);
  if (!cfAccess(u.role, on, viewAllowed(u.role, CF_VIEW)).open || (u.role !== 'klient' && !firmAllowed(u.principal, firm.id, firm.ownerId))) return new Response('Forbidden', { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const today = todayIso();
  const o = cfOptsFrom(sp, cfSettings(firm));
  const C = await loadCashflow(firm, today, o);
  const P = C.plan;
  const head: (string | number)[][] = [[`Паричен тек – прогноза ${o.horizon} дена · ${firm.name}`], [`Од ${dmy(today)} до ${dmy(P.end)} · почетна состојба ${P.start}${C.min ? ` · минимум ${C.min}` : ''}`], []];
  const byDay = [...head, ['Датум', 'Приливи', 'Одливи', 'Состојба', 'Под нула', 'Под минимум'],
    ...P.days.map((d) => [dmy(d.date), d.inn, d.out, d.bal, d.bal < 0 ? 'да' : '', C.min && d.bal < C.min ? 'да' : ''])];
  const byWeek = [...head, ['Од', 'До', 'Приливи', 'Одливи', 'Нето', 'Состојба на крај'],
    ...P.weeks.map((w) => [dmy(w.from), dmy(w.to), w.inn, w.out, Math.round((w.inn - w.out) * 100) / 100, w.bal])];
  const items = [...head, ['Датум', 'Вид', 'Опис', 'Документ', 'Износ'], ...P.items.map((i) => [dmy(i.date), CF_KIND[i.kind], i.label, i.ref ?? '', i.amount])];
  const warn = [...head, ['Предупредувања'], ...P.warnings.map((w) => [w])];
  const wb = XLSX.utils.book_new();
  const add = (rows: (string | number)[][], name: string, cols: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = cols.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add(byDay, 'По ден', [12, 14, 14, 16, 10, 12]);
  add(byWeek, 'По недела', [12, 12, 14, 14, 14, 16]);
  add(items, 'Ставки', [12, 24, 50, 16, 14]);
  add(warn, 'Предупредувања', [110]);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="Paricen_tek_${o.horizon}_${today}.xlsx"`,
    },
  });
}
