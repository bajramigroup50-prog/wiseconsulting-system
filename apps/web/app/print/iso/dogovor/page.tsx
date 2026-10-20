/**
 * The employment contracts of the office's own colleagues for signing on paper (ISO/IEC 27001 A.6.2, A.6.6, ЗЗЛП):
 * one (`?e=`) or all active (`?all=1`), from the registered contract (Вработени → Договор) or – when none is saved yet –
 * the proposal from the employee card, with the ISO / ЗЗЛП articles, place and date, both signatures, 2 copies; every
 * page carries the employee's name and the page number.
 */
import { notFound } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { can, hrCtDefaults, monthHours, resolvePayParams, type HrContract } from '@wise/core';
import { employees, hrContracts, hrDocs } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { viewAllowed } from '@/lib/nav';
import { today } from '@/lib/office';
import { contractHtml } from '@/lib/payroll/docs';
import { payCtx } from '@/lib/payroll/server';
import { officeFirm } from '../../../(app)/iso/iso-data';

export const metadata = { title: 'Договори за вработување' };

/** Footer of every printed page: the employee and the page (CSS paged media; a separate named page per contract). */
const pageCss = (i: number, name: string) => `@page c${i}{size:A4;margin:16mm 16mm 18mm;@bottom-left{content:${JSON.stringify(`${name} – Договор за вработување`)};font:8pt Arial;color:#555}@bottom-right{content:"ОБР-09 · в.1.0 · стр. " counter(page);font:8pt Arial;color:#555}}.ct${i}{page:c${i}}`;

export default async function PrintIsoContracts({ searchParams }: { searchParams: Promise<{ e?: string; all?: string }> }) {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'iso') || !can(u.principal, 'office', null)) notFound();
  const sp = await searchParams;
  const office = await officeFirm();
  if (!office) notFound();
  const E0 = await db().select().from(employees).where(eq(employees.firmId, office.id)).orderBy(employees.name);
  const E = sp.e ? E0.filter((e) => e.id === sp.e) : sp.all ? E0.filter((e) => e.active) : [];
  if (!E.length) notFound();
  const td = today();
  const [ctx, C] = await Promise.all([payCtx(office), db().select().from(hrContracts).where(and(inArray(hrContracts.employeeId, E.map((e) => e.id)), eq(hrContracts.current, true)))]);
  const D = C.length ? await db().select({ contractId: hrDocs.contractId, code: hrDocs.code, kind: hrDocs.kind }).from(hrDocs).where(inArray(hrDocs.contractId, C.map((c) => c.id))) : [];
  const P = { ...resolvePayParams({}, td.slice(0, 7), ctx.overrides), hours: monthHours(td.slice(0, 7)) };
  const docs = E.map((e) => {
    const ct = C.find((c) => c.employeeId === e.id);
    const saved: Partial<HrContract> | null = ct ? {
      ...(ct.data as Partial<HrContract>), type: ct.type as HrContract['type'], no: ct.no, signDate: ct.signDate, place: ct.place ?? '', start: ct.start, end: ct.end ?? '',
      reason: ct.reason ?? '', position: ct.position ?? '', duties: ct.duties ?? '', workPlace: ct.workPlace ?? '', hours: Number(ct.hours), probation: ct.probation ?? '',
      gross: Number(ct.gross ?? 0), net: Number(ct.net ?? 0), leave: ct.leave, notice: ct.notice, rep: ct.rep ?? '', repRole: ct.repRole ?? '', firstStart: ct.firstStart ?? ct.start,
    } : null;
    const c = hrCtDefaults({ ...e, netBase: Number(e.netBase), coef: Number(e.coef) }, { ...ctx.firm, officeFirm: true }, P, td, saved);
    const code = ct ? D.find((d) => d.contractId === ct.id && d.kind === 'contract')?.code ?? undefined : undefined;
    return { e, html: contractHtml(ctx.firm, { name: e.name, embg: e.embg, address: e.address, position: e.position, end: e.end }, c, { code }), saved: !!ct };
  });
  return (
    <div className="pdfdoc">
      <style dangerouslySetInnerHTML={{ __html: docs.map((d, i) => pageCss(i, d.e.name)).join('') + '.ctpage+.ctpage{break-before:page;page-break-before:always}' }} />
      {docs.map((d, i) => (
        <div key={d.e.id} className={`ctpage ct${i}`}>
          {!d.saved && <div className="noprint callout warn" style={{ marginBottom: 8 }}>⚠ {d.e.name}: договорот не е заведен во програмата (нема деловоден број и контролен код) – заведете го во Вработени → Договор пред потпишување.</div>}
          <div dangerouslySetInnerHTML={{ __html: d.html }} />
        </div>
      ))}
    </div>
  );
}
