/** P25 Ctrl+K „Пребарај екран…“ (`lib/nav-search.ts`): new and old names, Latin letters, and ONLY the user's own screens. */
import { describe, expect, it } from 'vitest';
import type { NavGroup } from './nav-data';
import { NAV, OWNER_VIEWS, navFlat, navFor, onlyViews, withoutViews } from './nav';
import { filterNavByModules } from './nav-industry';
import { newMenu } from './nav-new';
import { norm, searchIndex, searchScreens } from './nav-search';
import { BOOK_ALWAYS_VIEWS, BOOK_ONLY_VIEWS, demoViews } from './route-guard';

const EXTRA = [['lozinka', 'Мојот профил / лозинка / мени']] as const;
/** As the layout builds it: the filtered classic menu, the shown menu (new), the own profile. */
const idx = (classic: readonly NavGroup[]) => searchIndex(classic, newMenu(classic), EXTRA);
const find = (I: ReturnType<typeof idx>, q: string) => searchScreens(I, q).map((e) => e.id);
const viewsOf = (M: readonly NavGroup[]) => new Set(M.flatMap(([, L]) => navFlat(L).map(([v]) => v)));

const OWNER = idx(NAV);
const BOOK_MENU = onlyViews(withoutViews(filterNavByModules(navFor('acc'), null, false), OWNER_VIEWS), new Set([...BOOK_ONLY_VIEWS, ...BOOK_ALWAYS_VIEWS]));
const DEMO_MENU = onlyViews(filterNavByModules(navFor('acc'), null, false), demoViews());
const COLLEAGUE_MENU = withoutViews(NAV, OWNER_VIEWS);

describe('Ctrl+K search: names', () => {
  it('normalises Cyrillic / Latin', () => {
    expect(norm('⚖️ Законски промени')).toBe('zakonski promeni');
    expect(norm('Ѓорѓи Љубен Њ')).toBe('gjorgji ljuben nj');
  });
  it('finds a screen by its new name, its old name and in Latin', () => {
    expect(find(OWNER, 'закони')[0]).toBe('zakoni');
    expect(find(OWNER, 'правен асистент')).toContain('lawAi'); // a tab of „⚖ Закони“ now
    expect(find(OWNER, 'Законска усогласеност')).toContain('zakon');
    expect(find(OWNER, 'zakoni')).toContain('zakoni');
    expect(find(OWNER, 'izvodi')).toContain('banka');
    expect(find(OWNER, 'Банки и формати')).toContain('bankFmt'); // old name, folded into Изводи ⚙
    expect(find(OWNER, 'што каде кога')).toContain('zsRok'); // old name, a tab of „📅 Рокови“
    expect(find(OWNER, 'промени фирма')).toContain('izlezF'); // removed from the new menu, still findable
    expect(find(OWNER, 'лозинка')).toContain('lozinka');
  });
  it('tells where a folded screen lives now', () => {
    expect(OWNER.find((e) => e.id === 'lawAi')?.g).toBe('⚖ Закони');
    expect(OWNER.find((e) => e.id === 'zsRok')?.g).toBe('📅 Рокови');
    expect(OWNER.find((e) => e.id === 'bankFmt')?.g).toBe('⚙ Поставки на изводи');
  });
  it('empty / unknown queries give nothing', () => {
    expect(searchScreens(OWNER, '   ')).toEqual([]);
    expect(searchScreens(OWNER, 'qqqzzz')).toEqual([]);
  });
});

describe('Ctrl+K search respects access', () => {
  it.each([
    ['🔒 book-only colleague', BOOK_MENU],
    ['🎭 demo', DEMO_MENU],
    ['colleague (no owner screens)', COLLEAGUE_MENU],
    ['firm without the hotel module', filterNavByModules(NAV, { mods: [] }, true)],
  ] as const)('%s: the index is exactly the screens of the filtered menu (+ own profile)', (_, M) => {
    const I = idx(M);
    const V = viewsOf(M);
    for (const e of I) expect(V.has(e.id) || e.id === 'lozinka', e.id).toBe(true);
  });
  it('🔒 book-only colleague: law, deadlines, users, firms, owner screens are not found', () => {
    const I = idx(BOOK_MENU);
    for (const q of ['закони', 'правен асистент', 'рокови', 'корисници', 'досие', 'zakoni', 'produktivnost', 'формати по банка', 'автопилот']) {
      const R = find(I, q);
      for (const v of ['zakoni', 'lawAi', 'ujpZakoni', 'lawrep', 'zakon', 'rokovi', 'zsRok', 'korisnici', 'dosie', 'firmi', 'produktivnost', 'bankFmt', 'autop']) expect(R, `${q} → ${v}`).not.toContain(v);
    }
    expect(find(I, 'изводи')).toContain('banka');
  });
  it('🎭 demo: only demo views (law: the allowed tabs only)', () => {
    const I = idx(DEMO_MENU);
    const D = demoViews();
    for (const e of I) expect(D.has(e.id) || e.id === 'lozinka' || e.id === 'home', e.id).toBe(true);
    const law = find(I, 'закони');
    expect(law).not.toContain('lawAi');
    expect(law).not.toContain('zakoni');
    expect(find(I, 'корисници')).toContain('korisnici'); // the demo office's own users (DEMO_OFFICE_VIEWS)
    expect(find(I, 'резервна копија')).not.toContain('sistem');
  });
  it('owner-only screens only for the owner', () => {
    for (const v of OWNER_VIEWS) {
      expect(idx(COLLEAGUE_MENU).some((e) => e.id === v), v).toBe(false);
      expect(OWNER.some((e) => e.id === v), v).toBe(true);
    }
  });
});
