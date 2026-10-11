'use server';
/**
 * „📥 Плата од Excel“ (legacy v478 `plxTpl` / `plxImp`): template with the firm's employees, import as a draft
 * month. New employees are created, missing card fields filled; nothing is booked until „Пресметка (F4)“.
 * The import file name and warnings are kept in the audit row (`plxImp`), which the month editor shows.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { monthSplit, payDraft } from '@wise/core';
import { plxEmp, plxFileName, plxMatch, plxParse, plxTemplate } from '@wise/core/payroll/xlsx-import';
import { audit, employees, payrollRuns, saveRun, type Employee, type NewEmployee } from '@wise/db';
import { db } from '@/lib/db';
import { coreEmp, firmEmployees, isMonth, payAction, payCtx, payError } from '@/lib/payroll/server';

export interface PlxTemplate { error?: string; name?: string; sheets?: { name: string; rows: (string | number)[][] }[] }

export async function payXlsxTemplate(month: string): Promise<PlxTemplate> {
  try {
    if (!isMonth(month)) return { error: 'Изберете месец.' };
    const { firm } = await payAction('plxTpl');
    const E = await firmEmployees(firm.id);
    return {
      name: plxFileName(month, firm.name),
      sheets: plxTemplate(month, E.map((e) => ({ ...coreEmp(e), active: e.active })), monthSplit(month)),
    };
  } catch (e) { return payError(e); }
}

export interface PlxResult { error?: string; ok?: string; confirm?: string; month?: string }

export async function payXlsxImport(month: string, file: string, aoa: string[][], replace: boolean): Promise<PlxResult> {
  try {
    if (!isMonth(month)) return { error: 'Изберете месец.' };
    if (!Array.isArray(aoa) || aoa.length > 5001) return { error: 'Датотеката не може да се прочита.' };
    const P = plxParse(aoa.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])));
    if ('error' in P) return { error: P.error };
    if (!P.rows.length) return { error: 'Нема редови со вработени.' };
    const { u, firm } = await payAction('plxImp');
    const fname = String(file || 'Excel').slice(0, 120);
    const r = await db().transaction(async (tx) => {
      const [ex] = await tx.select({ id: payrollRuns.id, status: payrollRuns.status }).from(payrollRuns)
        .where(and(eq(payrollRuns.firmId, firm.id), eq(payrollRuns.month, month))).limit(1);
      if (ex && !replace) {
        return { confirm: `За ${month} веќе има зачувана пресметка. Вработените од Excel ќе ја заменат во предлогот (ништо не се менува додека не притиснете „Пресметка (F4)“). Да продолжам?` };
      }
      const ctx = await payCtx(firm, tx);
      const all: Employee[] = await firmEmployees(firm.id, tx);
      const d = payDraft(month, all.map(coreEmp), ctx.overrides);
      const M = monthSplit(month);
      const warn: string[] = [];
      let nNew = 0;
      const emps = [];
      for (const rec of P.rows) {
        let E = plxMatch(rec, all);
        if (!E) {
          if (!rec.name) { warn.push('ЕМБГ ' + rec.embg + ': нема име – прескокнат'); continue; }
          const [{ m }] = (await tx.select({ m: sql<number>`coalesce(max(case when ${employees.no} ~ '^[0-9]+$' then ${employees.no}::int end), 0)::int` })
            .from(employees).where(eq(employees.firmId, firm.id))) as [{ m: number }];
          const row: NewEmployee = {
            firmId: firm.id, no: String(m + 1), name: rec.name, embg: rec.embg || null, netBase: String(rec.net || 0), coef: String(rec.coef || 1), active: true,
            position: rec.pos || null, oe: rec.oe || null, mpOps: rec.ops || null, mpZan: rec.fzo || null, start: rec.start || null,
          };
          const [ins] = await tx.insert(employees).values(row).returning();
          E = ins!;
          all.push(E);
          nNew++;
        } else {
          const up: Partial<NewEmployee> = {};
          if (rec.pos && !E.position) up.position = rec.pos;
          if (rec.oe && rec.oe !== E.oe) up.oe = rec.oe;
          if (rec.ops && rec.ops !== E.mpOps) up.mpOps = rec.ops;
          if (rec.fzo && rec.fzo !== E.mpZan) up.mpZan = rec.fzo;
          if (rec.embg && !E.embg) up.embg = rec.embg;
          if (rec.start && !E.start) up.start = rec.start;
          if (Object.keys(up).length) {
            const [upd] = await tx.update(employees).set(up).where(eq(employees.id, E.id)).returning();
            Object.assign(E, upd);
          }
        }
        const x = plxEmp(rec, { ...coreEmp(E), start: E.start ?? null }, month, d.params, M);
        if (x.hNormSave) await tx.update(employees).set({ hNorm: String(x.hNormSave), ...(E.mpC26 ? {} : { mpC26: '0047' }) }).where(eq(employees.id, E.id));
        warn.push(...x.warn);
        emps.push(x.e);
      }
      if (!emps.length) return { error: 'Ниту еден вработен не е увезен.' };
      const s = await saveRun(tx, { firmId: firm.id, month, params: d.params, emps, userId: u.id, source: 'xlsx', runId: ex?.id ?? null });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'plxImp', entityType: 'payroll_run', entityId: s.id, data: { month, file: fname, emps: emps.length, nNew, warn: warn.slice(0, 200) } });
      return { ok: 'Увезени ' + emps.length + ' вработени' + (nNew ? ' (' + nNew + ' нови во Вработени)' : '') + (warn.length ? ' · ' + warn.length + ' предупредувања' : '') + '. Проверете и притиснете „Пресметка (F4)“.', month };
    });
    revalidatePath('/plati');
    revalidatePath(`/plati/${month}`);
    revalidatePath('/vraboteni');
    return r;
  } catch (e) { return payError(e); }
}
