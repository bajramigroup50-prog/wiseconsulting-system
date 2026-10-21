/**
 * UX Phase 1 „ново“ menu (`lib/nav-new.ts`, docs/ux-rindertim.md P13–P17, P5, P8, P9, P14) next to the „класично“ menu
 * (the legacy `NAV`, unchanged — its own tests in nav*.test.ts still pin it). The new menu is only a re-arrangement of the
 * user's already filtered menu: it never adds a view, and every view of the classic menu stays reachable.
 */
import { describe, expect, it } from 'vitest';
import type { NavGroup, NavItem } from './nav-data';
import { NAV, OWNER_VIEWS, navFor, onlyViews, withoutViews } from './nav';
import { filterNavByModules } from './nav-industry';
import { FIRM_MORE_LABEL, menuSize, newMenu } from './nav-new';
import { HUBS, MENU_HUBS, sameScreen } from './nav-hubs';
import { BOOK_ALWAYS_VIEWS, BOOK_ONLY_VIEWS, demoViews } from './route-guard';

const ids = (L: readonly NavItem[]): string[] => L.flatMap((x) => (x[0] === '-' ? [] : x[0] === '>' ? ids(x[2] ?? []) : [x[0]]));
const all = (N: readonly NavGroup[]) => N.flatMap(([, L]) => ids(L));
const grp = (N: readonly NavGroup[], g: string) => N.find(([n]) => n === g)?.[1] ?? [];
const count = (N: readonly NavGroup[], id: string) => all(N).filter((x) => x === id).length;
const subs = (L: readonly NavItem[]) => L.filter((x) => x[0] === '>').map((x) => x[1]);

const NEW = newMenu(NAV);

/** The menus the layout builds (`app/(app)/layout.tsx`), classic. */
const BOOK = new Set([...BOOK_ONLY_VIEWS, ...BOOK_ALWAYS_VIEWS]);
const menus: [string, readonly NavGroup[]][] = [
  ['owner', NAV],
  ['colleague (full access, no owner views)', withoutViews(NAV, OWNER_VIEWS)],
  ['🔒 book-only colleague', onlyViews(withoutViews(filterNavByModules(navFor('acc'), null, false), OWNER_VIEWS), BOOK)],
  ['🎭 demo', onlyViews(filterNavByModules(navFor('acc'), null, false), demoViews())],
  ['firm without modules', filterNavByModules(NAV, { mods: [] })],
  ['firm with hotel + transport', filterNavByModules(NAV, { mods: ['hotel', 'frt'] })],
];

describe('classic menu (P40 „класично“) is the legacy NAV, unchanged', () => {
  it('14 groups, the duplicates still there', () => {
    expect(NAV).toHaveLength(14);
    expect(count(NAV, 'dosie')).toBe(2);
    expect(count(NAV, 'korisnici')).toBe(2);
    expect(menuSize(NAV)).toEqual({ groups: 14, items: 206 }); // + 🔎 Контрола на комитенти, + 📥 Прием на документи, + 📣 Објави на мрежи (owner only), + bankSite and ⚙ Автоматизации (owner only), 📥 Пристигнати документи (UX P7), Аналитика (akart), 📋 Преглед на внес (vnes), 🏅 ISO – Квалитет (iso), 🤝 IFAC (ifac)
  });
});

describe('new menu (P40 „ново“)', () => {
  it('before → after: 14 → 13 groups, 197 → 172 entries', () => {
    expect(menuSize(NEW)).toEqual({ groups: 13, items: 180 }); // + 🔎 Контрола на комитенти, + 📥 Прием, + 📣 Објави на мрежи, + 📥 Пристигнати документи (UX P7), Аналитика (akart), 📋 Преглед на внес (vnes), 🏅 ISO (iso), 🤝 IFAC (ifac)
    // Финансово opens with „Аналитика ▸“: every analytic screen in one submenu, „Аналитика“ (akart) first
    const first = grp(NEW, 'Финансово').find((x) => x[0] !== '-')!;
    expect([first[0], first[1], first[2]?.[0]?.[0]]).toEqual(['>', 'Аналитика', 'akart']);
    expect((first[2] ?? []).map((x) => x[0])).toEqual(expect.arrayContaining(['akart', 'kartici', 'recFree', 'bkAdv', 'kkart', 'analitika', 'poobjekti']));
    // Бруто биланс on Финансово itself, right under „Аналитика ▸“ (not inside it)
    expect(grp(NEW, 'Финансово').filter((x) => x[0] !== '-').map((x) => x[0]).slice(0, 2)).toEqual(['>', 'bilanc']);
    expect(NEW.map(([g]) => g)).not.toContain('Излез');
  });
  it('P13 Архива once: dosie / paket only in Архива', () => {
    for (const v of ['dosie', 'paket']) { expect(count(NEW, v)).toBe(1); expect(ids(grp(NEW, 'Архива'))).toContain(v); }
  });
  it('P14 Фирми: one item + „⋯“ (import, from a decision, modules), separated blocks; no „Промени фирма“ / Излез', () => {
    const F = grp(NEW, 'Фирми');
    expect(count(NEW, 'firmi')).toBe(1);
    expect(ids(F)).toContain('firmi');
    const more = F.find((x) => x[0] === '>' && x[1] === FIRM_MORE_LABEL);
    expect(more && ids(more[2] ?? [])).toEqual(['firmiImp', 'firmiResh', 'moduli']);
    expect(F.filter((x) => x[0] === '-').length).toBeGreaterThanOrEqual(3);
    expect(all(NEW)).not.toContain('izlezF');
    // the top-level Фирми list is short now (was 29 items)
    expect(F.filter((x) => x[0] !== '-').length).toBeLessThan(21); // 20 with 📥 Пристигнати документи (UX P7)
  });
  it('P15 Корисници only in Систем', () => {
    expect(count(NEW, 'korisnici')).toBe(1);
    expect(ids(grp(NEW, 'Систем'))).toContain('korisnici');
  });
  it('P16 „🏭 Производство“ once (Материјално)', () => {
    expect(subs(grp(NEW, 'Материјално'))).toContain('🏭 Производство');
    expect(subs(grp(NEW, 'Малопродажба'))).not.toContain('🏭 Производство');
    for (const v of ['normativ', 'prod', 'mrp', 'lotovi']) expect(count(NEW, v)).toBe(1);
  });
  it('P17 (menu only): no item twice between Материјално / Малопродажба / Финансово', () => {
    for (const v of ['efaktura', 'prenosi', 'uprosek', 'kalkCalc']) { expect(count(NEW, v), v).toBe(1); expect(ids(grp(NEW, 'Материјално'))).toContain(v); }
    for (const v of ['fiskPer', 'poobjekti']) { expect(count(NEW, v), v).toBe(1); expect(ids(grp(NEW, 'Финансово'))).toContain(v); }
    // the screens themselves are not merged (later phase): the retail-only screens stay
    for (const v of ['kalkM', 'm_lager', 'm_kartica', 'masovnoM']) expect(ids(grp(NEW, 'Малопродажба'))).toContain(v);
  });
  it('P8 / P9: one „⚖ Закони“ and one „📅 Рокови“ item, opening the first tab', () => {
    const F = grp(NEW, 'Фирми');
    expect(F.find((x) => x[0] === 'zakoni')?.[1]).toBe('⚖ Закони');
    expect(F.find((x) => x[0] === 'rokovi')?.[1]).toBe('📅 Рокови');
    for (const v of ['lawAi', 'ujpZakoni', 'lawrep', 'zakon', 'zsRok']) expect(all(NEW), v).not.toContain(v);
    expect(sameScreen('zakoni', 'lawAi')).toBe(true);
    expect(sameScreen('rokovi', 'zsRok')).toBe(true);
    expect(sameScreen('zakoni', 'rokovi')).toBe(false);
  });
  it('P5: bank formats fold into „Изводи → ⚙“', () => {
    expect(all(NEW)).not.toContain('bankFmt');
    expect(ids(grp(NEW, 'Финансово'))).toEqual(expect.arrayContaining(['banka', 'devizni']));
  });
  it('the one-item groups / P18–P24 (not approved yet) are untouched', () => {
    for (const g of ['Основни средства', 'Камати', 'Помош', 'Шифрарник', 'Дејности']) expect(grp(NEW, g)).toEqual(grp(NAV, g));
  });

  describe.each(menus)('%s', (_, M) => {
    const N = newMenu(M);
    it('never shows a view the classic (filtered) menu does not show', () => {
      const C = new Set(all(M));
      for (const v of all(N)) expect(C.has(v), v).toBe(true);
    });
    it('every classic view stays reachable: in the menu, as a tab of a menu screen, under Изводи ⚙, or the top bar ⏏', () => {
      const shown = new Set(all(N));
      for (const v of new Set(all(M))) {
        if (shown.has(v) || v === 'izlezF') continue;
        const hub = MENU_HUBS.find((h) => h.members.includes(v));
        if (hub) { expect(hub.members.some((m) => shown.has(m)), v).toBe(true); continue; }
        const cfg = HUBS.find((h) => h.key === 'izvodiCfg')!;
        expect(cfg.tabs.some((t) => t.view === v) && (shown.has('banka') || shown.has('devizni')), v).toBe(true);
      }
    });
    it('no empty group, submenu or doubled separator', () => {
      for (const [g, L] of N) {
        expect(ids(L).length, g).toBeGreaterThan(0);
        L.forEach((x, i) => { if (x[0] === '-') expect(i > 0 && i < L.length - 1 && L[i - 1]![0] !== '-', g).toBe(true); });
      }
    });
  });

  it('a user who may open only some law screens gets the hub item on the first one (custom access)', () => {
    const M = onlyViews(NAV, new Set(['lawrep', 'zakon', 'zsRok']));
    const N = newMenu(M);
    expect(all(N).filter((v) => ['lawrep', 'zakon', 'zsRok'].includes(v))).toEqual(['lawrep', 'zsRok']);
    expect(N.flatMap(([, L]) => L).find((x) => x[0] === 'lawrep')?.[1]).toBe('⚖ Закони');
  });
  it('🔒 book-only colleague: the new menu shows no law / deadline / firm-admin screen', () => {
    const N = newMenu(menus[2]![1]);
    for (const v of ['zakoni', 'lawAi', 'ujpZakoni', 'lawrep', 'zakon', 'rokovi', 'zsRok', 'firmi', 'korisnici', 'dosie', 'bankFmt']) expect(all(N), v).not.toContain(v);
  });
  it('🎭 demo: only demo views (law: the two allowed tabs → one item)', () => {
    const N = newMenu(menus[3]![1]);
    const D = demoViews();
    for (const v of all(N)) expect(D.has(v) || v === 'home', v).toBe(true);
    expect(N.flatMap(([, L]) => L).find((x) => x[1] === '⚖ Закони')?.[0]).toMatch(/^(lawrep|zakon)$/);
  });
});
