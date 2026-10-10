'use server';
import { revalidatePath } from 'next/cache';
import { empParse } from '@wise/core/payroll/emp-import';
import { redirect } from 'next/navigation';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { resolvePayParams } from '@wise/core';
import { employeeFromRead, readEmbg, type ReadEmployee } from '@wise/core/ai/employee';
import { aiDocuments, audit, employees, fileLinks, files, payrollEmp, type NewEmployee } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { payAction, payCtx, payError } from '@/lib/payroll/server';

const opt = z.string().trim().max(300).transform((s) => s || null);
const dateOpt = opt.refine((s) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s), 'Неважечки датум.');
const numOpt = z.string().trim().transform((s) => (s === '' ? null : s.replace(',', '.'))).refine((s) => s == null || Number.isFinite(+s), 'Внесете број.');
const EmployeeInput = z.object({
  no: opt,
  name: z.string().trim().min(2, 'Внесете име и презиме.').max(200),
  embg: opt.refine((s) => !s || /^\d{13}$/.test(s), 'ЕМБГ има 13 цифри.'),
  position: opt, oe: opt, city: opt, address: opt,
  email: opt.refine((s) => !s || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), 'Неважечка е-пошта.'),
  netBase: numOpt, coef: numOpt, stazPrev: numOpt, stazY: numOpt, hNorm: numOpt, leaveDays: numOpt,
  start: dateOpt, end: dateOpt, m1Date: dateOpt, lekDate: dateOpt, bzrDate: dateOpt,
  contract: z.enum(['', 'определено', 'неопределено']).transform((s) => s || null),
  bankAcc: opt, bank: opt,
  mpOps: opt.refine((s) => !s || /^\d{1,4}$/.test(s), 'Шифра на општина.'),
  mpZan: opt.refine((s) => !s || /^\d{4,6}$/.test(s), 'Шифра на подрачна единица.'),
  mpC26: opt,
  active: z.boolean(),
});
const TEXT = ['no', 'name', 'embg', 'position', 'oe', 'city', 'address', 'email', 'netBase', 'coef', 'stazPrev', 'stazY', 'hNorm', 'leaveDays',
  'start', 'end', 'm1Date', 'lekDate', 'bzrDate', 'contract', 'bankAcc', 'bank', 'mpOps', 'mpZan', 'mpC26'] as const;

class UserError extends Error {}

/** Legacy `saveS('employees')` / `addEmpNow` (number = max + 1, leave 20 days, coef 1). */
export async function saveEmployee(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get('id') ?? '') || null;
  let back = '/vraboteni';
  try {
    const { u, firm } = await payAction('write');
    const parsed = EmployeeInput.safeParse({ ...Object.fromEntries(TEXT.map((k) => [k, String(form.get(k) ?? '')])), active: form.get('active') === 'on' });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = parsed.data;
    const row: Partial<NewEmployee> = {
      ...v, netBase: v.netBase ?? '0', coef: v.coef ?? '1', leaveDays: v.leaveDays ? Math.round(+v.leaveDays) : 20,
      stazPrev: v.stazPrev, stazY: v.stazY, hNorm: v.hNorm,
    };
    await db().transaction(async (tx) => {
      if (!row.no) {
        const [{ m }] = (await tx.select({ m: sql<number>`coalesce(max(case when ${employees.no} ~ '^[0-9]+$' then ${employees.no}::int end), 0)::int` })
          .from(employees).where(eq(employees.firmId, firm.id))) as [{ m: number }];
        row.no = String(m + 1);
      }
      if (row.embg) {
        const [dup] = await tx.select({ name: employees.name }).from(employees)
          .where(and(eq(employees.firmId, firm.id), eq(employees.embg, row.embg), id ? ne(employees.id, id) : undefined)).limit(1);
        if (dup) throw new UserError(`ЕМБГ ${row.embg} веќе е внесен кај „${dup.name}“.`);
      }
      if (id) {
        const [before] = await tx.select().from(employees).where(and(eq(employees.id, id), eq(employees.firmId, firm.id))).limit(1);
        if (!before) throw new UserError('Вработениот не постои.');
        await tx.update(employees).set(row).where(eq(employees.id, id));
        const changed = Object.fromEntries(Object.entries(row).filter(([k, x]) => String(before[k as keyof typeof before] ?? '') !== String(x ?? '')));
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'saveS', entityType: 'employee', entityId: id, data: changed });
      } else {
        const [e] = await tx.insert(employees).values({ ...row, name: v.name, firmId: firm.id }).returning({ id: employees.id });
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'addEmpNow', entityType: 'employee', entityId: e!.id, data: { name: v.name, no: row.no } });
      }
    });
    back = String(form.get('back') || '/vraboteni');
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    return payError(e);
  }
  revalidatePath('/vraboteni');
  redirect(back.startsWith('/') ? back : '/vraboteni');
}

/** Delete an employee that is not in any payroll run (otherwise mark inactive). Needs `del`. */
export async function deleteEmployee(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('del');
    const msg = await db().transaction(async (tx) => {
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(payrollEmp)
        .where(and(eq(payrollEmp.firmId, firm.id), eq(payrollEmp.employeeId, id)))) as [{ n: number }];
      if (n) return `Не може да се избрише – вработениот е во ${n} пресметки на плата. Означете го како неактивен.`;
      const [e] = await tx.delete(employees).where(and(eq(employees.id, id), eq(employees.firmId, firm.id))).returning();
      if (e) await audit(tx, { userId: u.id, firmId: firm.id, action: 'delS', entityType: 'employee', entityId: id, data: { name: e.name, embg: e.embg } });
      return null;
    });
    if (msg) return { error: msg };
  } catch (e) { return payError(e); }
  revalidatePath('/vraboteni');
  return { ok: 'Избришано.' };
}

/** Legacy admin patch `slDel` (16934–16950): delete the ticked employees; those in payroll runs are skipped. */
export async function deleteEmployeesBulk(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ids = form.getAll('ids').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 2000);
  if (!ids.length) return { error: 'Изберете (кутичката лево).' };
  try {
    const { u, firm } = await payAction('del');
    if (u.role !== 'admin') return { error: 'Бришење може само администраторот.' };
    const r = await db().transaction(async (tx) => {
      const used = new Set((await tx.select({ id: payrollEmp.employeeId }).from(payrollEmp)
        .where(and(eq(payrollEmp.firmId, firm.id), inArray(payrollEmp.employeeId, ids)))).map((x) => x.id));
      const del = ids.filter((id) => !used.has(id));
      const gone = del.length ? await tx.delete(employees).where(and(eq(employees.firmId, firm.id), inArray(employees.id, del))).returning({ id: employees.id, name: employees.name }) : [];
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'slDel', entityType: 'employee', data: { deleted: gone.map((x) => x.name), skipped: used.size } });
      return { n: gone.length, skip: used.size };
    });
    revalidatePath('/vraboteni');
    return { ok: `Избришани: ${r.n}${r.skip ? ` · ${r.skip} се во пресметки на плата – означете ги како неактивни` : ''}.` };
  } catch (e) { return payError(e); }
}

/** Legacy `IMP_T.employees` import (Excel template „Vraboteni.xlsx“): adds new employees, fills empty fields of existing ones (by ЕМБГ, else name). */
export async function importEmployeesXlsx(rows: string[][]): Promise<ActionState> {
  try {
    const R = empParse(Array.isArray(rows) ? rows.slice(0, 5001) : []);
    if ('error' in R) return { error: R.error };
    const { u, firm } = await payAction('write');
    const r = await db().transaction(async (tx) => {
      const all = await tx.select().from(employees).where(eq(employees.firmId, firm.id));
      let m = Math.max(0, ...all.map((e) => parseInt(e.no ?? '') || 0));
      let n = 0, up = 0;
      for (const x of R) {
        const ex = all.find((e) => x.embg && e.embg === x.embg) ?? all.find((e) => e.name.toLowerCase() === x.name.toLowerCase());
        const vals = Object.fromEntries(Object.entries(x).filter(([, v]) => v !== '' && v != null)) as Partial<NewEmployee>;
        if (ex) {
          const patch = Object.fromEntries(Object.entries(vals).filter(([k]) => { const c = (ex as Record<string, unknown>)[k]; return c == null || c === '' || (k === 'netBase' && !Number(c)); }));
          if (Object.keys(patch).length) { await tx.update(employees).set(patch).where(eq(employees.id, ex.id)); up++; }
        } else {
          const [ins] = await tx.insert(employees).values({ ...vals, name: x.name, firmId: firm.id, no: x.no || String(++m), netBase: x.netBase || '0', coef: x.coef || '1', leaveDays: x.leaveDays ? Number(x.leaveDays) : 20, active: true } as NewEmployee).returning();
          all.push(ins!);
          n++;
        }
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'impEmployees', entityType: 'employee', data: { added: n, updated: up } });
      return { n, up };
    });
    revalidatePath('/vraboteni');
    return { ok: `Увезени ${r.n} нови вработени${r.up ? `, дополнети ${r.up}` : ''}.` };
  } catch (e) { return payError(e); }
}

/**
 * Legacy `readEmployeeDocs` (6047–6056, "Додај вработени од PDF"): apply finished `EMP_PROMPT` reads — update the
 * employee with the same ЕМБГ or add a new one (net from the gross with the current month's params) and link the
 * document (`file_links` entity `employee`). The user confirmed the list of read documents.
 */
export async function saveEmployeesFromReads(docIds: string[]): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('write');
    const ids = (Array.isArray(docIds) ? docIds : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
    if (!ids.length) return { error: 'Нема прочитани документи.' };
    const month = new Date().toISOString().slice(0, 7);
    const { overrides } = await payCtx(firm);
    const P = (() => { try { return resolvePayParams(null, month, overrides); } catch { return null; } })();
    const out = await db().transaction(async (tx) => {
      const D = await tx.select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.kind, 'emp'), eq(aiDocuments.status, 'done'), inArray(aiDocuments.id, ids)));
      const names = new Map((D.length ? await tx.select({ id: files.id, name: files.name }).from(files).where(inArray(files.id, D.flatMap((d) => (d.fileId ? [d.fileId] : [])))) : []).map((f) => [f.id, f.name]));
      let added = 0, updated = 0;
      for (const d of D) {
        const r = (d.result ?? {}) as ReadEmployee;
        const emb = readEmbg(r);
        const all = await tx.select().from(employees).where(eq(employees.firmId, firm.id));
        const ex = emb ? all.find((e) => String(e.embg ?? '').replace(/\D/g, '') === emb) ?? null : null;
        const nextNo = String(Math.max(0, ...all.map((e) => parseInt(e.no ?? '') || 0)) + 1);
        const v = employeeFromRead(r, { fileName: (d.fileId && names.get(d.fileId)?.replace(/\.[^.]+$/, '')) || 'Вработен', ex, nextNo, P });
        const row = { ...v, netBase: String(v.netBase), coef: String(v.coef), stazPrev: String(v.stazPrev) };
        let id: string;
        if (ex) {
          await tx.update(employees).set(row).where(eq(employees.id, ex.id));
          id = ex.id; updated++;
        } else {
          id = (await tx.insert(employees).values({ ...row, firmId: firm.id }).returning({ id: employees.id }))[0]!.id; added++;
        }
        if (d.fileId) await tx.insert(fileLinks).values({ fileId: d.fileId, entityType: 'employee', entityId: id, role: 'source' }).onConflictDoNothing();
        await audit(tx, { userId: u.id, firmId: firm.id, action: ex ? 'saveS' : 'addEmpNow', entityType: 'employee', entityId: id, data: { name: v.name, embg: v.embg, from: 'ai', aiDoc: d.id } });
      }
      await tx.update(aiDocuments).set({ status: 'saved' }).where(inArray(aiDocuments.id, D.map((d) => d.id)));
      return { added, updated };
    });
    revalidatePath('/vraboteni');
    return { ok: `Додадени ${out.added}, ажурирани ${out.updated} вработени – проверете ги податоците.` };
  } catch (e) { return payError(e); }
}

/** Legacy `activateEmp` / deactivate. */
export async function setEmployeeActive(id: string, active: boolean): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('write');
    await db().transaction(async (tx) => {
      await tx.update(employees).set({ active }).where(and(eq(employees.id, id), eq(employees.firmId, firm.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'activateEmp', entityType: 'employee', entityId: id, data: { active } });
    });
  } catch (e) { return payError(e); }
  revalidatePath('/vraboteni');
  return { ok: 'Зачувано.' };
}
