/**
 * Legacy `frDnevPdfHTML` (14575): ПРЕСМЕТКА НА ДНЕВНИЦИ ЗА СЛУЖБЕНО ПАТУВАЊЕ ВО СТРАНСТВО — per tour a table of the
 * countries (entry, exit, hours, per diems, amount, rate, denars), total per currency and in denars, the legal note and
 * the signatures (with the firm stamp). `?id=` = one tour (`ACT.frDnPdf`), `?drv=&mo=` = a driver's month (`ACT.frDnDrv`).
 */
import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { FR_REDUCTIONS, currencyText, frCountryName, frDnevTours } from '@wise/core/industry';
import { invoicePrintImg } from '@wise/core/sales';
import { freightTours } from '@wise/db';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { freightContext } from '@/lib/freight';
import { industryPage } from '@/lib/industry';
import { DocHead } from '@/components/industry-print';

export default async function FrDnevPrint({ searchParams }: { searchParams: Promise<{ id?: string; drv?: string; mo?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('frDnev', 'Дневници во странство');
  if (g.blocked) notFound();
  const f = g.firm;
  const X = await freightContext(f);
  let T;
  let sub: string;
  if (sp.id) {
    T = await db().select().from(freightTours).where(and(eq(freightTours.id, sp.id), eq(freightTours.firmId, f.id))).limit(1);
    if (!T.length) notFound();
    sub = 'Тура ' + T[0]!.number;
  } else {
    const mo = /^\d{4}-\d{2}$/.test(sp.mo ?? '') ? sp.mo! : notFound();
    const all = await db().select().from(freightTours).where(eq(freightTours.firmId, f.id)).orderBy(asc(freightTours.date));
    T = frDnevTours(all, mo).filter((t) => (t.driverId || '-') === (sp.drv || '-'));
    sub = `${sp.drv && sp.drv !== '-' ? X.driver(sp.drv) : '(без возач)'} · ${mo}`;
  }
  const stamp = String(((f.settings ?? {}) as Record<string, unknown>).stamp ?? '').trim();
  let tot = 0;
  const by: Record<string, number> = {};
  const parts = T.map((t) => {
    const d = X.dn(t);
    tot += d.mkd;
    for (const [c, v] of Object.entries(d.by)) by[c] = Math.round(((by[c] ?? 0) + v) * 100) / 100;
    return { t, d };
  });
  return (
    <>
      <DocHead firm={f} title="ПРЕСМЕТКА НА ДНЕВНИЦИ ЗА СЛУЖБЕНО ПАТУВАЊЕ ВО СТРАНСТВО" sub={sub} />
      {parts.map(({ t, d }) => (
        <div key={t.id}>
          <h3 style={{ fontSize: 12, margin: '10px 0 4px' }}>{t.number} · {X.driver(t.driverId)} · {X.plate(t.vehicleId)} · {t.loadPlace ?? ''} → {t.unloadPlace ?? ''}</h3>
          <table className="dense"><thead><tr><th>Држава</th><th>Влез</th><th>Излез</th><th className="n">Часови</th><th className="n">Дневници</th><th className="n">Износ</th><th className="n">Курс</th><th className="n">Денари</th></tr></thead>
            <tbody>{d.rows.map((r, i) => (
              <tr key={i}><td>{frCountryName(r.c)}</td><td>{String(r.in || '').replace('T', ' ')}</td><td>{String(r.out || '').replace('T', ' ')}</td><td className="n">{r.hrs != null ? Math.round(r.hrs * 100) / 100 : ''}</td>
                <td className="n">{r.u}</td><td className="n">{fmt(r.v)} {r.cur}</td><td className="n">{r.fx}</td><td className="n">{fmt(r.m)}</td></tr>))}</tbody>
            <tfoot><tr><th colSpan={5}>{(t.red || 100) < 100 ? 'Намалување: ' + (FR_REDUCTIONS.find((x) => x[0] === t.red)?.[1] ?? '') : 'Вкупно'}</th><th className="n">{currencyText(d.by, fmt)}</th><th /><th className="n">{fmt(d.mkd)}</th></tr></tfoot></table>
        </div>
      ))}
      {!parts.length && <p className="note">Нема патувања со внесени граници.</p>}
      <p style={{ marginTop: 10 }}><b>Вкупно: {currencyText(by, fmt)} = {fmt(tot)} ден.</b></p>
      <p className="note" style={{ fontSize: 9 }}>Пресметано според Уредбата за издатоците за службени патувања и селидби во странство (време од премин на македонската граница; полни 24 ч = 1 дневница, остаток над 12 ч = 1, 8–12 ч = ½). Курс: среден курс на НБРМ.</p>
      <div className="sig" style={{ marginTop: 30, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <span>Пресметал: ____________</span><span>Возач: ____________</span>
        <span>{stamp && <img src={invoicePrintImg(stamp)} alt="" style={{ maxHeight: 55 }} />} Одобрил: ____________</span>
      </div>
    </>
  );
}
