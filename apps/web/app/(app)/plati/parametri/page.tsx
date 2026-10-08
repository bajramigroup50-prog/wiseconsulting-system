/** Legacy `payParams` 7736 (modal under Пресметка на плата) — parameters by period, per firm (FIX #10), plus accounts, payment orders and the MPIN template. */
import Link from 'next/link';
import { asc, eq, isNull } from 'drizzle-orm';
import { PAY_DEF, PAY_KEYS, PAY_RATE_KEYS, payRows, type MpinTemplate } from '@wise/core';
import { payrollParams } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { payCtx, payPage } from '@/lib/payroll/server';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { MpinTemplateForm, OrdersForm, ParamTable, SchemeForm } from './forms';
import type { ParamRowInput } from './actions';

const toInput = (r: typeof payrollParams.$inferSelect): ParamRowInput => {
  const o: ParamRowInput = { from: r.from, src: r.src ?? '' };
  for (const k of PAY_RATE_KEYS) o[k] = r[k] == null ? '' : String(Number(r[k]));
  return o;
};

export default async function ParametriPage() {
  const { u, firm } = await payPage('plati');
  if (!firm) return <NoFirm t="Параметри за плата" />;
  const [office, own, ctx] = await Promise.all([
    db().select().from(payrollParams).where(isNull(payrollParams.firmId)).orderBy(asc(payrollParams.from)),
    db().select().from(payrollParams).where(eq(payrollParams.firmId, firm.id)).orderBy(asc(payrollParams.from)),
    payCtx(firm),
  ]);
  const eff = payRows(ctx.overrides);
  const last = eff.at(-1)!;
  const lastIn: ParamRowInput = { from: last.from, ...Object.fromEntries(PAY_RATE_KEYS.map((k) => [k, String(last[k] ?? '')])) };
  const write = canDo(u, 'write', firm.id), settings = canDo(u, 'settings', firm.id);
  const tpl = ctx.template as MpinTemplate | null;
  return (
    <>
      <Hd t="Параметри за плата по периоди" sub={firm.name}><Link className="btn" href="/plati">← Пресметка на плата</Link></Hd>
      <p className="note">Секој ред важи од наведениот месец до следниот ред. Кога УЈП ќе објави нови износи (просечна плата, основици, минимална плата, ослободување) или нови стапки, додадете нов ред „Важи од“ и зачувајте – пресметките од тој месец натаму ги користат новите вредности, а старите месеци остануваат непроменети (секоја пресметка ги чува своите параметри). Празно поле = вредноста од претходниот ред.</p>
      <div className="card">
        <h2>Важечки параметри за {firm.name}</h2>
        <div className="tw"><table className="dense">
          <thead><tr>{PAY_KEYS.map(([k, n]) => <th key={k} className={k === 'src' || k === 'from' ? undefined : 'n'}>{n}</th>)}<th>Извор</th></tr></thead>
          <tbody>{eff.map((r) => (
            <tr key={r.from}>{PAY_KEYS.map(([k]) => <td key={k} className={k === 'src' || k === 'from' ? undefined : 'n'}>{String((r as Record<string, unknown>)[k] ?? '')}</td>)}
              <td>{r.user ? <span className="pill info">измена</span> : PAY_DEF.some((d) => d.from === r.from) ? <span className="pill">закон</span> : ''}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
      <ParamTable scope="firm" rows={own.map(toInput)} last={lastIn} canEdit={write} />
      <ParamTable scope="office" rows={office.map(toInput)} last={lastIn} canEdit={settings} />
      <SchemeForm scheme={ctx.settings.scheme} canEdit={settings} />
      <OrdersForm o={ctx.orders} canEdit={write} defaults={{ payerAcc: ctx.firm.bankAccount, signer: ctx.firm.signer }} />
      <MpinTemplateForm info={tpl ? { edb: tpl.edb ?? '', emps: Object.keys(tpl.emp ?? {}).length, ver: tpl.ver } : null} canEdit={write} />
    </>
  );
}
