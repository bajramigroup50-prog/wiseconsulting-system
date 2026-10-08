/**
 * MPIN export of a payroll month (legacy `mpinExport` 6141 → 15356, `mpinXlsx` 7790, wrapped by `pnBlock` 15273):
 * default → MPI3 `.txt` in windows-1251 bytes from `@wise/core` `mpinTxt`; `?f=xlsx` → Excel; `?arhiva=<id>` → an archived export.
 *
 * FIX(#7): legacy archived the file even when the export was aborted (its archive wrapper ran on every path).
 * Here a row in `payroll_exports` is written only after the file was built, in the same request that returns it.
 * FIX(#11): each export is its own row by `kind` (no shared `docs/mpin-{month}` id with the УЈП acceptance).
 * Blocked while pay-change notes are open; a header that differs from the official УЈП row needs `?force=1`.
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { mpinParamDiff, mpinRows, mpinTxt, payNotesOpen, resolvePayParams } from '@wise/core';
import { audit, loadRun, payrollExports, payrollNotes } from '@wise/db';
import { db } from '@/lib/db';
import { h, htmlResponse, printDoc } from '@/lib/payroll/html';
import { mpinXlsx } from '@/lib/payroll/mpin-export';
import { coreEmp, firmEmployees, isMonth, payCtx, payRoute } from '@/lib/payroll/server';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const file = (bytes: Uint8Array, name: string, mime: string) =>
  new Response(Buffer.from(bytes), { headers: { 'content-type': mime, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'no-store' } });
const page = (title: string, body: string) => htmlResponse(printDoc(title, `<div style="font-size:13px;line-height:1.5">${body}</div>`));

export async function GET(req: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!isMonth(month)) return new Response('Not found', { status: 404 });
  const q = new URL(req.url).searchParams;
  const xlsx = q.get('f') === 'xlsx';
  const g = await payRoute(xlsx ? 'mpinXlsx' : 'mpinXml');
  if (g instanceof Response) return g;
  const { u, firm } = g;
  const run = await loadRun(db(), firm.id, { month });
  if (!run) return new Response('Пресметката не постои.', { status: 404 });

  const arch = q.get('arhiva');
  if (arch) {
    const [x] = await db().select().from(payrollExports).where(and(eq(payrollExports.id, arch), eq(payrollExports.runId, run.id))).limit(1);
    if (!x?.content) return new Response('Не постои.', { status: 404 });
    return file(x.content, x.name, x.mime);
  }

  const notes = payNotesOpen(await db().select().from(payrollNotes).where(and(eq(payrollNotes.firmId, firm.id), eq(payrollNotes.done, false))), month);
  if (notes.length) {
    return page('МПИН – блокирано', `<h2>⛔ Не може да продолжите – ${notes.length} отворени известувања за промени</h2><p>${notes.map((n) => h(n.type + (n.empName ? ' – ' + n.empName : ''))).join('<br>')}</p><p>Прво внесете ги промените во платата и означете ги „✓ Внесено“.</p>`);
  }
  if (!run.emps.length) return page('МПИН', '<p>Нема вработени во пресметката.</p>');
  const ctx = await payCtx(firm);
  const E = (await firmEmployees(firm.id)).map(coreEmp);
  const P = resolvePayParams(run.params, month, ctx.overrides);

  let bytes: Uint8Array, name: string, mime: string, info: Record<string, unknown>;
  if (xlsx) {
    const R = mpinRows(run.emps, P, E);
    bytes = mpinXlsx(R, ctx.firm, month);
    name = `MPIN_${month}.xlsx`;
    mime = XLSX_MIME;
    info = { emps: R.length, gross: R.reduce((s, r) => s + r.gross, 0) };
  } else {
    const diff = mpinParamDiff(month, P);
    if (diff.length && q.get('force') !== '1') {
      return page('МПИН – параметри', `<h2>⚠ Параметрите се разликуваат од официјалните на УЈП за ${h(month)}</h2><p>${diff.map(h).join('<br>')}</p><p>УЈП ќе ја одбие пријавата ако заглавјето не одговара. Поправете ги параметрите на месецот („Врати ги важечките“), или <a href="?force=1">извезете сепак</a>.</p>`);
    }
    if (!ctx.firm.edb) return page('МПИН', '<p>Внесете ЕДБ на фирмата (Фирми → Измени) – без ЕДБ МПИН не може да се поднесе.</p>');
    const r = mpinTxt({ month, params: P, emps: run.emps }, {
      firm: { edb: ctx.firm.edb, embs: ctx.firm.embs, name: ctx.firm.name, address: ctx.firm.address, city: ctx.firm.city, opstina: ctx.firm.opstina },
      employees: E, template: ctx.template, overrides: ctx.overrides,
    });
    bytes = r.bytes;
    name = r.name;
    mime = 'text/plain; charset=windows-1251';
    info = { emps: r.R.length, miss: r.miss, opsMiss: r.opsMiss, tpl: r.tpl, gross: r.R.reduce((s, x) => s + x.gross, 0) };
  }
  // FIX(#7/#11): archive only a successfully built file, one row per export kind.
  await db().transaction(async (tx) => {
    const [x] = await tx.insert(payrollExports).values({
      firmId: firm.id, runId: run.id, kind: xlsx ? 'mpin-xlsx' : 'mpin-txt', name, mime, size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), content: bytes, info, createdBy: u.id,
    }).returning({ id: payrollExports.id });
    await audit(tx, { userId: u.id, firmId: firm.id, action: xlsx ? 'mpinXlsx' : 'mpinXml', entityType: 'payroll_run', entityId: run.id, data: { name, exportId: x!.id, ...info } });
  });
  return file(bytes, name, mime);
}
