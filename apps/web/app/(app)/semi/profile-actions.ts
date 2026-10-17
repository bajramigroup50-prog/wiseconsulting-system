'use server';
/**
 * Numbered posting schemes „Шема 2, 3 …“ of the current firm (`@wise/db` `scheme-profiles.ts`): save, delete, copy to
 * other firms (the user's firms; „сите фирми“ only for the office owner). Editing schemes needs `settings` (`schSave`);
 * the semi view is hidden from book-only colleagues, so these actions are refused for them by the route guard too.
 * A 🎭 demo user edits only its demo firm's schemes (the demo firms are its only firms) and never copies to all firms.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { can } from '@wise/core';
import { schemeNoOf } from '@wise/core/scheme-profiles';
import { copySchemeProfile, deleteSchemeProfile, firms, saveSchemeProfile, SchemeProfileError } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { firmListSql, refuseDemo } from '@/lib/demo';
import { isOfficeOwner, OWNER_ONLY_MSG } from '@/lib/office-owner';
import { queueRepostChange } from '@/lib/auto-repost';
import { SCH_FIELD_KEYS, VAT_RATES } from './schema';

const PATHS = ['/semi', '/izlez', '/vlez', '/nalozi', '/partneri'];
const done = () => { for (const p of PATHS) revalidatePath(p); };

export async function saveSchemeProfileAction(_p: ActionState, f: FormData): Promise<ActionState> {
  let created = 0;
  try {
    const { u, firm, year } = await firmAction('schSave');
    const g = (k: string) => String(f.get(k) ?? '').trim();
    const sch: Record<string, string> = {};
    for (const k of SCH_FIELD_KEYS) { const v = g('s_' + k); if (v) sch[k] = v; }
    const map = (p: string) => Object.fromEntries(VAT_RATES.map((r) => [String(r), g(p + r)]).filter(([, v]) => v));
    const no = schemeNoOf(g('no'));
    const prof = await db().transaction((tx) => saveSchemeProfile(tx, firm.id, {
      no: no > 1 ? no : null, name: g('name'), sch, vatIn: map('VI'), vatImp: map('VM'), vatOut: map('VO'),
    }, { userId: u.id, name: u.name }));
    done();
    if (no <= 1) created = prof.no;
    else return { ok: `Шема ${prof.no} – „${prof.name}“ е зачувана. Важи за новите книжења на документите со оваа шема; веќе книжените – со „Прекнижи“.` + (await queueRepostChange({ firmIds: [firm.id], reason: 'schemes', year, userId: u.id })) };
  } catch (e) {
    if (e instanceof SchemeProfileError) return { error: e.message };
    return actionError(e);
  }
  redirect(`/semi?sema=${created}`);
}

export async function deleteSchemeProfileAction(no: number): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('schSave');
    const name = await db().transaction((tx) => deleteSchemeProfile(tx, firm.id, schemeNoOf(no), u.id));
    done();
    return { ok: `Шема ${no} – „${name}“ е избришана.` };
  } catch (e) {
    if (e instanceof SchemeProfileError) return { error: e.message };
    return actionError(e);
  }
}

/** Copy „Шема N“ to the chosen firms (`firm` fields), or with `all=1` to every firm of the office (owner only). */
export async function copySchemeProfileAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('schSave');
    const no = schemeNoOf(f.get('no'));
    const all = f.get('all') === '1';
    let targets: string[];
    if (all) {
      await refuseDemo(u, 'schProfileCopyAll');
      if (!(await isOfficeOwner(u))) return { error: OWNER_ONLY_MSG };
      targets = (await db().select({ id: firms.id }).from(firms).where(firmListSql(u))).map((x) => x.id);
    } else {
      const mine = new Set((await db().select({ id: firms.id }).from(firms).where(firmListSql(u))).map((x) => x.id));
      targets = f.getAll('firm').map(String).filter((id) => mine.has(id));
    }
    // the user must be allowed to edit the schemes of every target firm
    targets = targets.filter((id) => id !== firm.id && can(u.principal, 'schSave', id));
    if (!targets.length) return { error: 'Изберете барем една фирма.' };
    const R = await db().transaction((tx) => copySchemeProfile(tx, firm.id, no, targets, { userId: u.id, name: u.name }));
    done();
    const sk = R.skipped.length ? ` Прескокнати ${R.skipped.length}: ${R.skipped.slice(0, 5).map((s) => `${s.firm} (${s.reason})`).join('; ')}${R.skipped.length > 5 ? '…' : ''}.` : '';
    return R.copied.length ? { ok: `Шемата е копирана во ${R.copied.length} фирми.${sk}` } : { error: `Шемата не е копирана ни во една фирма.${sk}` };
  } catch (e) {
    if (e instanceof SchemeProfileError) return { error: e.message };
    return actionError(e);
  }
}
