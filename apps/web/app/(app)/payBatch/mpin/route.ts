/**
 * Legacy `pbMpinZip` (v507/v510): one MPIN (MPI3 .txt) per calculated firm of the month in one zip; each file is also
 * archived on the run (`payroll_exports`, like Плати → МПИН). Firms with open pay-change notes, without a 13-digit
 * ЕДБ or without employees are skipped and listed in `upozorenja.txt`.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { can, mpinTxt, payNotesOpen, resolvePayParams } from '@wise/core';
import { audit, loadRun, payrollExports, payrollNotes, payrollRuns } from '@wise/db';
import { getUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { zipFiles } from '@/lib/docx';
import { allowedFirms } from '@/lib/office';
import { coreEmp, firmEmployees, isMonth, payCtx } from '@/lib/payroll/server';

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return new Response('unauthorized', { status: 401 });
  const q = new URL(req.url).searchParams;
  const month = q.get('m') ?? '';
  if (!isMonth(month)) return new Response('Неважечки месец.', { status: 400 });
  const only = q.get('f');
  const F = (await allowedFirms(u)).filter((f) => can(u.principal, 'mpinXml', f.id) && (!only || f.id === only));
  const runs = F.length ? await db().select().from(payrollRuns).where(and(inArray(payrollRuns.firmId, F.map((f) => f.id)), eq(payrollRuns.month, month))) : [];
  const files: { name: string; data: Uint8Array | string }[] = [];
  const warn: string[] = [];
  for (const run of runs) {
    const f = F.find((x) => x.id === run.firmId)!;
    const edb = String(f.edb ?? '').replace(/\D/g, '');
    if (edb.length !== 13) { warn.push(`${f.name}: ЕДБ нема 13 цифри – МПИН не е направен`); continue; }
    const notes = payNotesOpen(await db().select().from(payrollNotes).where(and(eq(payrollNotes.firmId, f.id), eq(payrollNotes.done, false))), month);
    if (notes.length) { warn.push(`${f.name}: ${notes.length} отворени известувања за промени – прескокнато`); continue; }
    const R = await loadRun(db(), f.id, { id: run.id });
    if (!R?.emps.length) continue;
    try {
      const ctx = await payCtx(f);
      const E = (await firmEmployees(f.id)).map(coreEmp);
      const P = resolvePayParams(R.params, month, ctx.overrides);
      const r = mpinTxt({ month, params: P, emps: R.emps }, {
        firm: { edb: ctx.firm.edb, embs: ctx.firm.embs, name: ctx.firm.name, address: ctx.firm.address, city: ctx.firm.city, opstina: ctx.firm.opstina },
        employees: E, template: ctx.template, overrides: ctx.overrides,
      });
      const nm = f.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      files.push({ name: `МПИН – ${nm} – ЕДБ ${edb} – ${month.slice(0, 4)} – ${r.name}`, data: r.bytes });
      await db().transaction(async (tx) => {
        const [x] = await tx.insert(payrollExports).values({
          firmId: f.id, runId: run.id, kind: 'mpin-txt', name: r.name, mime: 'text/plain; charset=windows-1251', size: r.bytes.length,
          sha256: createHash('sha256').update(r.bytes).digest('hex'), content: r.bytes, info: { emps: r.R.length, miss: r.miss, batch: true }, createdBy: u.id,
        }).returning({ id: payrollExports.id });
        await audit(tx, { userId: u.id, firmId: f.id, action: 'mpinXml', entityType: 'payroll_run', entityId: run.id, data: { name: r.name, exportId: x!.id, batch: true } });
      });
      if (r.miss) warn.push(`${f.name}: ${r.miss} вработени без точен ЕМБГ`);
      if (r.opsMiss?.length) warn.push(`${f.name}: без шифра на општина – ${r.opsMiss.slice(0, 5).join(', ')}${r.opsMiss.length > 5 ? ' …' : ''}`);
      if (!r.tpl) warn.push(`${f.name}: нема МПИН шаблон (некои шифри се стандардни)`);
    } catch (e) { warn.push(`${f.name}: грешка – ${(e as Error).message}`); }
  }
  if (!files.length) return new Response('Нема пресметани плати за МПИН.\n' + warn.join('\n'), { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (warn.length) files.push({ name: 'upozorenja.txt', data: warn.join('\r\n') });
  const zip = zipFiles(files);
  return new Response(Buffer.from(zip), { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="MPIN_${month}_${files.length - (warn.length ? 1 : 0)}_firmi.zip"`, 'cache-control': 'no-store' } });
}
