import 'server-only';
/** The signed-in user's `mayOpen` (`lib/screen-access.ts`), memoised per request: tab strips and `/ekran/<hub>`. */
import { cache } from 'react';
import { can, hasPerm, type Perm } from '@wise/core';
import { requireUser } from './auth';
import { myViews } from './can-see';
import { currentFirm } from './context';
import { isDemoUser } from './demo';
import { isOfficeOwner } from './office-owner';
import { mayOpen } from './screen-access';

export const screenMay = cache(async (): Promise<(view: string, perm?: string) => boolean> => {
  const u = await requireUser();
  const demo = isDemoUser(u);
  const [firm, views, owner] = await Promise.all([
    currentFirm(u).catch(() => null),
    demo ? Promise.resolve(null) : myViews(),
    u.role === 'admin' && !demo ? isOfficeOwner(u).catch(() => false) : Promise.resolve(false),
  ]);
  const ctx = {
    role: u.role, demo, owner, views,
    // `officePage(…, { perm, demoGlobal })`: a demo user without a firm passes on the role's permission
    can: (p: string) => can(u.principal, p, firm?.id ?? null) || (demo && !firm && hasPerm(u.principal, p as Perm)),
  };
  return (view, perm) => mayOpen(ctx, view, perm);
});
