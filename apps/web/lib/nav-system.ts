/**
 * System / codebook screens reachable from „Сите шифрарници“ but not listed in legacy `NAV` (`cb_*`, `tarifi`,
 * `terkovi`, `uslugiS`, `banke`): they inherit the permission of `sifrarnik`. Labels for page titles.
 */
import type { Role } from '@wise/core';
import { CB, CB_KEYS, SIFRARNIK_SUBVIEWS } from '@wise/core/codebooks';
import { NAV_LBL, viewAllowed } from './nav';

export const SUB_LBL: Record<string, string> = {
  ...Object.fromEntries(CB_KEYS.map((k) => [`cb_${k}`, CB[k].t])),
  tarifi: 'Даночни тарифи', terkovi: 'Теркови за книжење', uslugiS: 'Услуги', banke: 'Банки',
};

/** `viewAllowed`, plus the codebook sub-screens for whoever may open „Сите шифрарници“. */
export const sysViewAllowed = (role: Role, id: string): boolean =>
  viewAllowed(role, id) || (SIFRARNIK_SUBVIEWS.includes(id) && viewAllowed(role, 'sifrarnik'));

export const sysLabel = (id: string): string => NAV_LBL[id] ?? SUB_LBL[id] ?? id;
