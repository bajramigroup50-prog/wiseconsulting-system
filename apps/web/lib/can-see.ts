import 'server-only';
/**
 * 🔒 `canSee(view)` for the UI: a link, button, tab or home widget that leads to a view is shown only when the route
 * guard (`proxy.ts`) would let the signed-in user open it. Memoised per request.
 * `myViews()`: the user's allowed views, or `null` = not restricted by „Колегите гледаат само сметководство“.
 */
import { cache } from 'react';
import { getUser } from './auth';
import { db } from './db';
import { viewsOf } from './view-access';
import { readOnlyIn } from './route-guard';

export const myViews = cache(async (): Promise<ReadonlySet<string> | null> => {
  const u = await getUser();
  return u ? viewsOf(db(), u) : null;
});

/** A sync test for a whole render: `const see = await viewSeer(); see('dosie') && <Link …>`. */
export async function viewSeer(): Promise<(view: string) => boolean> {
  const V = await myViews();
  return (v) => !V || V.has(v);
}

export const canSee = async (view: string): Promise<boolean> => (await viewSeer())(view);

/** The view is open read-only for this user (its server actions are refused): hide its write controls. */
export const viewReadOnly = async (view: string): Promise<boolean> => readOnlyIn(await myViews(), view);
