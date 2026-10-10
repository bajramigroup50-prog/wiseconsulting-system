/**
 * Автоматско дополнување залиха — legacy `VIEWS.dopolnuvanje` 9920, `replRows`, `replCfg`, `replMake` → `poCreate`:
 * suggestion = daily sales × (lead + cover days) + minimum − (stock − reserved + already ordered); supplier and price from
 * the last purchase; one supplier order per supplier.
 */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { Retail, stock } from '@wise/core';
import { lastSuppliers, partners } from '@wise/db';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { reservations, settingsOf } from '@/lib/retail';
import { stockPage, todayIso } from '@/lib/stock';
import { fq } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ActionForm } from '@/components/action-form';
import { createPosAction, replCfgAction } from '../_retail/actions';

const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export default async function DopolnuvanjePage() {
  const { u, firm, L } = await stockPage('dopolnuvanje');
  if (!firm || !L) return <NoFirm t="Автоматско дополнување на залиха" />;
  const write = canDo(u, 'replMake', firm.id);
  const c = { ...Retail.REPL_DEFAULTS, ...((settingsOf(firm).repl ?? {}) as Partial<Retail.ReplConfig>) };
  const from = addDays(todayIso(), -c.days);
  const out = new Map<string, number>();
  for (const m of L.ctx.moves) if (!m.pend && m.qty < 0 && m.date >= from && !/prenos|transfer/.test(String(m.type ?? ''))) out.set(m.item, (out.get(m.item) ?? 0) - m.qty);
  const [R, last, P] = await Promise.all([
    reservations(db(), firm.id), lastSuppliers(db(), firm.id),
    db().select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.firmId, firm.id)).orderBy(asc(partners.name)),
  ]);
  const pName = new Map(P.map((p) => [p.id, p.name]));
  const its = [...L.items.values()].map((i) => ({ id: i.id, code: i.code, name: i.name, type: i.type, active: i.active, min: i.minStock, lead: ((i.data as Record<string, unknown>).lead as number | undefined) ?? null }));
  const rows = Retail.replenishment(its, { cfg: c, outQty: out, stockOf: (id) => stock(L.ctx, id).qty, reserved: R.reserved, onOrder: R.onOrder });
  const createRepl = createPosAction.bind(null, 'repl');
  return (
    <>
      <Hd t="Автоматско дополнување на залиха" sub={`${rows.length} артикли за нарачка`}><Link className="btn" href="/nabavki">📦 Нарачки до добавувачи</Link></Hd>
      <ActionForm action={replCfgAction} className="card" reset={false}>
        <div className="form">
          <label className="f">Просек на продажба од последни (дена)<input name="days" inputMode="numeric" defaultValue={c.days} /></label>
          <label className="f">Рок на испорака од добавувач (дена)<input name="lead" inputMode="numeric" defaultValue={c.lead} /></label>
          <label className="f">Залиха да покрие уште (дена)<input name="cover" inputMode="numeric" defaultValue={c.cover} /></label>
        </div>
        {write && <div className="row"><span style={{ flex: 1 }} /><button className="btn">Пресметај</button></div>}
      </ActionForm>
      <ActionForm action={createRepl} className="" reset={false}>
        <div className="tw"><table className="dense">
          <thead><tr><th /><th>Артикл</th><th className="n">Залиха</th><th className="n">Резервирано</th><th className="n">Нарачано</th><th className="n">Продажба/ден</th><th className="n">Доволно за (дена)</th><th className="n">Минимум</th><th className="n">Предлог</th><th>Добавувач</th></tr></thead>
          <tbody>{rows.map((r) => {
            const ls = last.get(r.i.id);
            return (
              <tr key={r.i.id}>
                <td><input type="checkbox" name={'sel_' + r.i.id} defaultChecked /><input type="hidden" name={'pid_' + r.i.id} value={ls?.pid ?? ''} /><input type="hidden" name={'pr_' + r.i.id} value={ls?.price ?? 0} /></td>
                <td>{r.i.code ? r.i.code + ' · ' : ''}{r.i.name}</td><td className="n">{fq(r.st)}</td><td className="n">{r.res ? fq(r.res) : ''}</td><td className="n">{r.oo ? fq(r.oo) : ''}</td>
                <td className="n">{fq(Math.round(r.daily * 100) / 100)}</td>
                <td className="n" style={r.days != null && r.days <= c.lead ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{r.days == null ? '—' : r.days}</td>
                <td className="n">{Number(r.i.min) ? fq(r.i.min) : ''}</td>
                <td className="n"><input name={'q_' + r.i.id} inputMode="decimal" defaultValue={r.sug} style={{ width: 80 }} /></td>
                <td className="mini">{(ls?.pid && pName.get(ls.pid)) || '—'}</td>
              </tr>
            );
          })}{!rows.length && <tr><td colSpan={10} className="note">Нема артикли под потребното ниво.</td></tr>}</tbody>
        </table></div>
        {write && rows.length > 0 && <div className="row" style={{ marginTop: 8 }}><span style={{ flex: 1 }} /><button className="btn pri">Креирај нарачки до добавувачи</button></div>}
      </ActionForm>
      <p className="note">Предлог = просечна дневна продажба × (рок на испорака + дена покривање) + минимална залиха − (залиха − резервирано за нарачки + веќе нарачано). Добавувачот е од последната влезна фактура за артиклот.</p>
    </>
  );
}
