/** Legacy `miXls`: the owner's activity report as Excel. */
import * as XLSX from 'xlsx';
import { miRange } from '@wise/core/firms/mojizv';
import { getUser } from '@/lib/auth';
import { allowedFirms, today } from '@/lib/office';
import { miRows, reportOwner } from '../data';

export async function GET(req: Request) {
  const u = await getUser();
  const owner = await reportOwner();
  if (!u || !owner || owner.id !== u.id) return new Response('Forbidden', { status: 403 });
  const q = new URL(req.url).searchParams;
  const td = today();
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.get('m') ?? '') ? q.get('m')! : td.slice(0, 7);
  const y = /^\d{4}$/.test(q.get('y') ?? '') ? q.get('y')! : td.slice(0, 4);
  const R = miRange(q.get('md') === 'y' ? 'y' : 'm', m, y, td.slice(0, 7));
  const X = (await miRows(await allowedFirms(u), R)).sort((a, b) => b.items - a.items);
  const rows: (string | number)[][] = [['Фирма', 'ЕДБ', 'Излезни фактури', 'Приходи (ден, без ДДВ)', 'Набавки (ден, без ДДВ)', 'Трошоци кл. 4 (ден)', 'Влезни фактури', 'од тоа читани со AI', 'Изводи', 'Ставки во изводи', 'Малопродажба / сметки', 'Рачни налози', 'Вработени', 'Пресметки на плата', 'Вкупно ставки', 'Надоместок месечно', 'Надоместок за периодот', 'AI читања', 'AI трошок ($)', 'AI трошок (ден)', 'Ви останува (ден)', 'Ден по ставка']];
  for (const r of X) rows.push([r.F.name, r.F.edb ?? '', r.inv, Math.round(r.prih), Math.round(r.nab), Math.round(r.tro), r.pur, r.ai, r.stm, r.bl, r.sal, r.jr, r.emp, r.payEmp, r.items, r.fee, r.feeP, r.aiDocs, Math.round(r.aiUsd * 100) / 100, Math.round(r.aiMkd), Math.round(r.net), r.perItem == null ? '' : Math.round(r.perItem * 10) / 10]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 38 }, { wch: 15 }, ...rows[0]!.slice(2).map(() => ({ wch: 13 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Активност');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="Aktivnost_klienti_${R.m0}${R.m1 !== R.m0 ? '_' + R.m1 : ''}.xlsx"` } });
}
