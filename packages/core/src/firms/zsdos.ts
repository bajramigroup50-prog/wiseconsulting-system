/** Year-end dossier by year (legacy `ZY_ROLES` / `zyNeed` / `zyCard` 11111–11131). */
import type { YeEntity } from '../yearend';

/** [role, label, kind: 1 = generated, 2 = official confirmation, 0 = other] */
export const ZY_ROLES: readonly (readonly [string, string, 0 | 1 | 2])[] = [
  ['xml', 'XML за ЦРМ', 1], ['bs', 'Биланс на состојба (PDF)', 1], ['bu', 'Биланс на успех (PDF)', 1], ['bel', 'Објаснувачки белешки (PDF)', 1],
  ['db', 'Даночен биланс ДБ (PDF)', 1], ['crm', 'Официјална / прифатена сметка од ЦРМ (PDF)', 2], ['ujp', 'Потврда за поднесен ДБ од УЈП (PDF)', 2],
  ['oth', 'Друго (стари годишни сметки, извештаи…)', 0],
];
export const isZyRole = (r: unknown): r is string => typeof r === 'string' && ZY_ROLES.some(([k]) => k === r);

/** Legacy `zyNeed`: documents a complete year has. */
export const zyNeed = (ent: YeEntity): string[] => (ent === 'co' ? ['xml', 'bs', 'bu', 'bel', 'db', 'crm', 'ujp'] : ['bs', 'bu', 'bel', 'crm']);

export const zyComplete = (ent: YeEntity, roles: Iterable<string>): boolean => { const R = new Set(roles); return zyNeed(ent).every((r) => R.has(r)); };

/** Where each generated document is made in the program (print view / export). */
export const ZY_SOURCE: Readonly<Record<string, string>> = { xml: '/zsXml', bs: '/pecati/bs-crm', bu: '/pecati/bu-crm', bel: '/pecati/bel', db: '/pecati/db' };
