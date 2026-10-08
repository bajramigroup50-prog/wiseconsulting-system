/**
 * Roles and permissions, ported from legacy `ROLES` / `RP` / `ACT_NEED` / `firmAllowed`
 * (legacy/index.html ~line 5455). Every server action goes through `can()`.
 */

export const ROLE_IDS = ['admin', 'senior', 'acc', 'oper', 'teren', 'view', 'klient'] as const;
export type Role = (typeof ROLE_IDS)[number];

export const PERMS = ['write', 'del', 'fix', 'settings', 'users', 'firms', 'close', 'office', 'teren'] as const;
export type Perm = (typeof PERMS)[number];

export const ROLES: Record<Role, { n: string; d: string }> = {
  admin: { n: 'Администратор', d: 'Сите фирми, корисници, поставки, бришење и затворање година.' },
  senior: { n: 'Главен сметководител', d: 'Доделените фирми: сè, освен управување со корисници, бришење и рачна корекција на налози (само администраторот).' },
  acc: { n: 'Сметководител', d: 'Доделените фирми: внес, измена на документи, книжење, извештаи. Без бришење и рачна корекција на налози. Без нови/бришење фирми, шеми и затворање година.' },
  oper: { n: 'Оператор (внесувач)', d: 'Доделените фирми: скенирање и внес на фактури, изводи, каса. Без бришење и поставки.' },
  teren: { n: 'Терен (теренски работник)', d: 'Гледа само „Мои задачи“: ги прифаќа, завршува и прикачува скенирани документи. Нема пристап до сметководството.' },
  view: { n: 'Преглед', d: 'Доделените фирми: само преглед, извештаи и печатење.' },
  klient: { n: 'Клиент (портал)', d: 'Само својата фирма: документи на фирмата, КДФИ, влезни/излезни фактури и деловите според дејноста. Без книжење, налози, бришење и поставки.' },
};

export const RP: Record<Role, readonly Perm[]> = {
  admin: ['write', 'del', 'fix', 'settings', 'users', 'firms', 'close', 'office'],
  senior: ['write', 'settings', 'firms', 'close', 'office'],
  acc: ['write', 'office'],
  oper: ['write', 'office'],
  teren: ['teren'],
  view: [],
  klient: ['write'],
};

/** Named actions → the permission they need (legacy `ACT_NEED`). Unlisted actions need `write`. */
export const ACT_NEED: Record<string, Perm> = {
  nalDel: 'del', nalEdit: 'fix', nalSave: 'fix', nalAddRow: 'fix', nalRmOrig: 'fix', nalRmAdd: 'fix',
  fxNew: 'settings', fxSave: 'settings', fxDel: 'settings', fxEdit: 'settings',
  tNew: 'office', tSave: 'office', tDel: 'office', tSt: 'office',
  tplNew: 'office', tplSave: 'office', tplDel: 'office', tplEdit: 'office', genTask: 'office',
  ncNew: 'office', ncSave: 'office', ncTask: 'office', ncCreateFirm: 'office', ncEdit: 'office',
  delFirm: 'firms', newFirm: 'firms', pickNew: 'firms', saveFirm: 'firms',
  closeYear: 'close', doTransfer: 'close', transfer: 'close',
  schSave: 'settings', schSaveAll: 'settings', schReset: 'settings', schRepost: 'settings',
  uSave: 'users', uDel: 'users', uNew: 'users', uEdit: 'users',
};

export interface Principal {
  id: string;
  role: Role;
  /** Firm ids the user is assigned to; `'*'` means all firms. */
  firms: readonly string[];
}

export const isRole = (r: unknown): r is Role => typeof r === 'string' && (ROLE_IDS as readonly string[]).includes(r);

export const hasPerm = (u: Principal | null | undefined, p: Perm): boolean => !!u && RP[u.role].includes(p);

/** Legacy `firmAllowed`: admin and `*` see every firm, others only assigned ones (or firms they own). */
export const firmAllowed = (u: Principal | null | undefined, firmId: string, ownerId?: string | null): boolean =>
  !!u && (u.role === 'admin' || u.firms.includes('*') || u.firms.includes(firmId) || (!!ownerId && ownerId === u.id));

/**
 * The single guard. `action` is a permission or a named legacy action.
 * With `firmId`, the user must also have access to that firm.
 */
export function can(u: Principal | null | undefined, action: Perm | string, firmId?: string | null): boolean {
  if (!u) return false;
  const perm: Perm = (PERMS as readonly string[]).includes(action) ? (action as Perm) : (ACT_NEED[action] ?? 'write');
  if (!hasPerm(u, perm)) return false;
  return firmId == null || firmAllowed(u, firmId);
}

/** Client-role entries are saved as pending until the office approves them. */
export const entryStatusFor = (u: Principal): 'pending' | 'posted' => (u.role === 'klient' ? 'pending' : 'posted');
