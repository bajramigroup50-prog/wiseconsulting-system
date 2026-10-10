import type { Role } from '@wise/core';
import { NAV as NAV_DATA, type NavGroup, type NavItem } from './nav-data';
import { addOfficeNav } from './nav-office';
import { addIndustryNav } from './nav-industry';
import { addLawNav } from './nav-law';
import { addTransportNav } from './nav-transport';
import { addFinanceNav } from './nav-finance';

/** Legacy `NAV` plus the items legacy added at runtime (per-phase files). */
export const NAV = addFinanceNav(addTransportNav(addIndustryNav(addLawNav(addOfficeNav(NAV_DATA)))));
export type { NavGroup, NavItem };

/** Legacy `NAV_SHORT` / `NAV_MINI` (group label abbreviations). */
export const NAV_SHORT: Record<string, string> = { 'Основни средства': 'Осн. средства' };
export const NAV_MINI: Record<string, string> = {
  'Канцеларија': 'Канц.', 'Материјално': 'Матер.', 'Малопродажба': 'Мало', 'Шифрарник': 'Шифр.',
  'Производство': 'Производ.', 'Основни средства': 'ОС', 'Крај на година': 'Крај год.', 'Финансово': 'Финанс.',
};

/** Legacy `navFlat`: drop separators, inline submenus. */
export const navFlat = (items: readonly NavItem[]): (readonly [string, string])[] =>
  items.flatMap((x) => (x[0] === '-' ? [] : x[0] === '>' ? navFlat(x[2] ?? []) : [[x[0], x[1] ?? x[0]] as const]));

export const hrefFor = (id: string) => (id === 'home' ? '/' : `/${id}`);

/** Label for a view id, first occurrence wins (legacy `NAV_LBL`). */
export const NAV_LBL: Record<string, string> = {};
for (const [, items] of NAV) for (const [id, t] of navFlat(items)) NAV_LBL[id] ??= t;

/** Nav per role (legacy `renderNav`): teren sees only its tasks; klient gets the portal menu (phase 9). */
export function navFor(role: Role): readonly NavGroup[] {
  if (role === 'teren') return [['Канцеларија', [['mojzad', 'Мои задачи'], ['mojpn', '🚚 Мои патни налози']]]];
  // Client portal menu (legacy `klNav` 9054); the office's per-firm section toggles are enforced by `officePage`.
  if (role === 'klient') return [['Мојата фирма', [['klHome', '🏠 Почетна'], ['klSend', '📤 Испрати документ'], ['dosie', '📁 Документи на фирмата'], ['arhiva', '📂 Архива на документи']]], ['Излез', [['izlezF', 'Излез']]]];
  return NAV;
}

/** View ids each role may open (used to guard the catch-all route). */
export const viewAllowed = (role: Role, id: string): boolean =>
  navFor(role).some(([, items]) => navFlat(items).some(([v]) => v === id)) || id === 'lozinka'
  // Office staff may preview the client portal pages (legacy `S.asClient`).
  || (['klHome', 'klSend'].includes(id) && !['klient', 'teren', 'view'].includes(role));
