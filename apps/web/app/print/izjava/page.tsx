/**
 * Legacy `zzIzj` → `zzOut` (Систем › Корисници, column „Изјава · Договор“): a colleague's confidentiality statement,
 * name / position / ЕМБГ / address filled from the office firm's employee with the same name (`zzPerson`).
 */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { izjavaBlocks, izjavaHtml } from '@wise/core/firms/izjava';
import { todaySkopje, tplPersonVars } from '@wise/core/office';
import { employees, firms, getOfficeProfile, users } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { fillOwnTemplate, ownTemplate } from '@/lib/own-template';

export const metadata = { title: 'Изјава за доверливост' };

export default async function PrintIzjava({ searchParams }: { searchParams: Promise<{ u?: string; builtin?: string }> }) {
  const sp = await searchParams;
  const me = await requireUser();
  if (!can(me.principal, 'users') || !sp.u || !/^[0-9a-f-]{36}$/i.test(sp.u)) notFound();
  const [u] = await db().select({ name: users.name }).from(users).where(eq(users.id, sp.u)).limit(1);
  if (!u) notFound();
  const O = await getOfficeProfile(db());
  const off = (await db().select().from(firms)).find((f) => (f.settings as { officeFirm?: boolean }).officeFirm);
  const E = off ? (await db().select().from(employees).where(eq(employees.firmId, off.id))).find((e) => e.name.trim().toLowerCase() === u.name.trim().toLowerCase()) : undefined;
  const e = E as unknown as { embg?: string | null; address?: string | null; position?: string | null } | undefined;
  // legacy `zzIzj` → `zzOut` → `tplRun(['d:Изјава за доверливост'], {P})`: the office's own template when one is active.
  const t = sp.builtin ? null : await ownTemplate(['d:Изјава за доверливост']);
  const tf = off ?? (await currentFirm(me));
  if (t && tf) {
    const R = await fillOwnTemplate(t, tf, tplPersonVars({ name: u.name, embg: e?.embg, position: e?.position }));
    return <div className="pdfdoc" dangerouslySetInnerHTML={{ __html: R.html() }} />;
  }
  const D = izjavaBlocks({ name: u.name, embg: e?.embg ?? null, address: e?.address ?? null, pos: e?.position ?? null }, { name: O.name || off?.name || '', city: off?.city ?? null }, todaySkopje());
  return <div className="pdfdoc" dangerouslySetInnerHTML={{ __html: izjavaHtml(D) }} />;
}
