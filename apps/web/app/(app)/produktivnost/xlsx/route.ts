/** „⬇ Excel“ of 📊 Продуктивност на вработените (owner only): summary, kinds of work, firms, days, unknown actions. */
import * as XLSX from 'xlsx';
import { WORK_CATS, catTotal, daysOf, firmCount } from '@wise/core/office/productivity';
import { ROLES } from '@wise/core';
import { firmName, loadProductivity, ownerGateApi, prodFilter, userName } from '../data';

export async function GET(req: Request) {
  if (!(await ownerGateApi())) return new Response('Forbidden', { status: 403 });
  const f = prodFilter(Object.fromEntries(new URL(req.url).searchParams));
  const D = await loadProductivity(f);
  const W = D.report.users.filter((w) => w.total > 0);
  const r2c = (c: number) => Math.round(c) / 100;
  const sum: (string | number)[][] = [[`Продуктивност на вработените ${f.from} – ${f.to}`], [],
    ['Корисник', 'Улога', 'Вкупно движења', 'Креирано', 'Изменето', 'Избришано', 'Фирми', 'Активни денови', 'Активно време (мин)', 'Движења / час',
      'Ставки во налози', 'Рачни налози', 'Изводи – увезени ставки', 'Изводи – прокнижени ставки', 'Излезни фактури', 'Излезни фактури (ден)', 'Влезни фактури', 'Влезни фактури (ден)', 'Најави / поставки (не се бројат)']];
  for (const w of W) {
    const u = w.userId ? D.users.get(w.userId) : null;
    sum.push([userName(D, w.userId), u ? ROLES[u.role]?.n ?? u.role : '', w.total, w.verbs.c, w.verbs.u, w.verbs.d, firmCount(w), w.activeDays, w.activeMin, w.perHour ?? '',
      w.vol.jLines, w.vol.journals, w.vol.bankImported, w.vol.bankBooked, w.vol.inv, r2c(w.vol.invCents), w.vol.pur, r2c(w.vol.purCents), w.noise]);
  }
  const cat: (string | number)[][] = [['Вид на работа', ...W.flatMap((w) => [`${userName(D, w.userId)} – вкупно`, 'креирано', 'изменето', 'избришано']), 'Вкупно']];
  for (const [c, l] of WORK_CATS) {
    const row = W.map((w) => catTotal(w, c));
    if (!row.some(Boolean)) continue;
    cat.push([l, ...W.flatMap((w) => { const v = w.byCat[c]; return [catTotal(w, c), v?.c ?? 0, v?.u ?? 0, v?.d ?? 0]; }), row.reduce((a, b) => a + b, 0)]);
  }
  const fr: (string | number)[][] = [['Корисник', 'Фирма', 'Движења', ...WORK_CATS.map(([, l]) => l)]];
  for (const w of W) for (const x of w.firms) fr.push([userName(D, w.userId), firmName(D, x.firmId), x.total, ...WORK_CATS.map(([c]) => x.byCat[c] ?? 0)]);
  const dy: (string | number)[][] = [['Ден', ...W.map((w) => userName(D, w.userId)), 'Вкупно']];
  for (const d of daysOf(f.from, f.to)) { const row = W.map((w) => w.days[d] ?? 0); dy.push([d, ...row, row.reduce((a, b) => a + b, 0)]); }
  const un: (string | number)[][] = [['Акција (не е во табелата)', 'Број']];
  for (const [a, n] of Object.entries(D.report.unknown).sort((a, b) => b[1] - a[1])) un.push([a, n]);

  const wb = XLSX.utils.book_new();
  const add = (rows: (string | number)[][], name: string, w0 = 30) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: w0 }, ...Array.from({ length: 40 }, () => ({ wch: 14 }))];
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add(sum, 'Преглед');
  add(cat, 'По вид на работа', 40);
  add(fr, 'По фирми');
  add(dy, 'По денови', 12);
  add(un, 'Непознати акции');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="Produktivnost_${f.from}_${f.to}.xlsx"`,
    },
  });
}
