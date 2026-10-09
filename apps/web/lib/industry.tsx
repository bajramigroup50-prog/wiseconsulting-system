import 'server-only';
/**
 * Shared server helpers for the Phase 10 industry pages: page guard with the module toggle (routes of a switched-off
 * module are blocked, FIX LEGACY-MAP 10.4 item 9), guarded + audited action runner, form parsing.
 */
import Link from 'next/link';
import { MODULE_OF_VIEW, viewEnabled } from '@wise/core/industry';
import type { Firm, IndActor, Tx } from '@wise/db';
import { booksPage, canDo } from './books';
import { bankRun } from './bank';
import { currentFirm } from './context';
import type { SessionUser } from './auth';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import type { FormState } from '@/components/bank-form';

export { num, str, isDate } from './bank';

/** True when the current firm has the view's module switched off. */
export async function moduleBlocked(u: SessionUser, view: string): Promise<boolean> {
  if (!MODULE_OF_VIEW[view]) return false;
  const f = await currentFirm(u);
  return !viewEnabled(view, f?.mods ?? [], { hasFirm: !!f, client: u.role === 'klient' });
}

export function ModuleOff({ t }: { t: string }) {
  return (
    <>
      <Hd t={t} />
      <div className="callout warn">Овој модул не е вклучен за фирмата. Вклучете го во <Link href="/moduli">🧩 Модули по дејност</Link>.</div>
    </>
  );
}

export type IndPage = { u: SessionUser; firm: Firm; year: number; write: boolean; del: boolean; blocked: React.ReactNode | null };

/** Page guard: signed in, view allowed, firm selected, module on. Returns `blocked` JSX to render instead otherwise. */
export async function industryPage(view: string, title: string): Promise<IndPage> {
  const { u, firm, year } = await booksPage(view);
  if (!firm) return { u, firm: null as unknown as Firm, year, write: false, del: false, blocked: <NoFirm t={title} /> };
  if (!viewEnabled(view, firm.mods, { hasFirm: true, client: u.role === 'klient' })) return { u, firm, year, write: false, del: false, blocked: <ModuleOff t={title} /> };
  return { u, firm, year, write: canDo(u, 'write', firm.id), del: canDo(u, 'del', firm.id), blocked: null };
}

export interface IndCtx { tx: Tx; u: SessionUser; firm: Firm; a: IndActor; year: number }

/** Guarded (`requireCan(action, firm)`), transactional action; the services check the module and write the audit rows. */
export function indRun(action: string, paths: string[], fn: (c: IndCtx) => Promise<string | void>): Promise<FormState> {
  return bankRun(action, paths, ({ tx, u, firm, year }) => fn({ tx, u, firm, year, a: { firmId: firm.id, userId: u.id, role: u.role } }));
}

export const today = () => new Date().toISOString().slice(0, 10);
export const nowLocal = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4);
  return d.toISOString().slice(0, 16);
};

/** Rows of a repeated form group: `prefix.field.i` → [{field: value}] (blank rows dropped by `keep`). */
export function rows<K extends string>(form: FormData, prefix: string, fields: readonly K[], keep: (r: Record<K, string>) => boolean): Record<K, string>[] {
  const max = Math.max(-1, ...[...form.keys()].filter((k) => k.startsWith(prefix + '.')).map((k) => Number(k.split('.').pop())).filter((x) => Number.isInteger(x)));
  const out: Record<K, string>[] = [];
  for (let i = 0; i <= max; i++) {
    const r = Object.fromEntries(fields.map((f) => [f, String(form.get(`${prefix}.${f}.${i}`) ?? '').trim()])) as Record<K, string>;
    if (keep(r)) out.push(r);
  }
  return out;
}
export const nz = (s: string): number => Number(String(s).replace(',', '.')) || 0;
