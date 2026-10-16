/** „⬇ Excel“ of the last „🏦 Примени за сите фирми“ run (owner only): the result per firm (done / skipped / error). */
import * as XLSX from 'xlsx';
import { bankKontaAllRun } from '@wise/db';
import { db } from '@/lib/db';
import { bsOwnerUser } from '../lib';

const ST = { done: 'направено', skipped: 'прескокнато', error: 'грешка' } as const;

export async function GET() {
  const me = await bsOwnerUser();
  if (!me) return new Response('Forbidden', { status: 403 });
  const run = await bankKontaAllRun(db());
  if (!run) return new Response('Not found', { status: 404 });
  const rows: (string | number)[][] = [
    [`Конта за изводи – за сите фирми, ${run.year}`], [`Започната ${run.at}${run.finishedAt ? ` · завршена ${run.finishedAt}` : ''} · ${run.done} / ${run.total} фирми · чекори: ${run.steps.join(', ')}`], [],
    ['Фирма', 'Статус', 'Сметки: старо → ново конто', 'Ставки 1009 → 10091', 'Изводи прекнижани збирно', 'Прескокнати изводи (заклучено)', 'Причина'],
  ];
  for (const r of run.results) {
    rows.push([r.name || r.firmId, ST[r.status], r.accounts.map((m) => `${m.name}: ${m.from} → ${m.to}`).join('; '), r.transitLines, r.layoutStatements, r.locked, r.reason ?? '']);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 40 }, { wch: 14 }, { wch: 50 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Резултат');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="Konta_izvodi_site_firmi_${run.year}.xlsx"`,
    },
  });
}
