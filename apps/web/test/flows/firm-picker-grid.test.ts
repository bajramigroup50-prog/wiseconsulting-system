/**
 * „Избор на работна фирма“ like the old program: the firm list without a firm is a dense grid (default view) with the
 * old columns filled from the firm, its import settings, its bank accounts and the year closing of the selected year;
 * search, Enter / double-click open the firm; access, demo and book-only isolation are unchanged.
 */
import { eq } from 'drizzle-orm';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { FG_COLS, fgApply, fgKey, type FpFirm } from '@wise/core/firms/picker';
import { jar, pg, setupDb, signIn, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push() {}, refresh() {}, back() {} }), usePathname: () => '/' }));

const { default: Home } = await import('@/app/(app)/page');
const { FirmPicker } = await import('@/components/firm-picker');

type PickerEl = ReactElement<{ rows: FpFirm[]; book: boolean; year: number; uid?: string }>;
const Y = new Date().getFullYear();
let A = '', B = '', C = '', D = '', E = '', owner = '';
const S: Record<string, string> = {};
const as = (k: string) => { jar.set('wc_sess', S[k]!); jar.delete('wc_fid'); useYear(Y); };
const picker = async () => {
  const el = await Home({ searchParams: Promise.resolve({}) }) as PickerEl;
  expect(el.type).toBe(FirmPicker);
  return el;
};

beforeAll(async () => {
  await setupDb();
  const F = await pg.insert(schema.firms).values([
    {
      name: 'АЛФА МЕДИКА ДООЕЛ', code: '3137', legalForm: 'dooel', edb: '4030000000011', embs: '7000011', address: 'Ул. Илинден 1', phone: '02 3111 222', activity: '86.230',
      settings: { parent: '2098', curYear: String(Y), fromYear: String(Y - 1), regNo: 'R-11', payCode: '930', realBank: '300000000099911', bankEdb: '4030990000001',
        depositor: 'ДЕП', bankAcc: '100000000000001', opstina: 'Центар', opstina2: 'Скопје', bank2: '210000000000222', accFee: 9000 },
    },
    { name: 'БЕТА ТП', code: '15', legalForm: 'tp', edb: '5030000000022', embs: '7000022' },
    { name: 'НОВА ФИРМА ДОО', legalForm: 'doo', edb: '4030000000033' },
    { name: 'ДЕМО ТРГОВИЈА ДООЕЛ', code: '1', settings: { demo: true } },
    { name: 'ДЕМО УСЛУГИ ДОО', code: '2', settings: { demo: true } },
  ]).returning();
  [A, B, C, D, E] = F.map((f) => f.id) as [string, string, string, string, string];
  await pg.insert(schema.bankAccounts).values([
    { firmId: A, name: 'Комерцијална банка', account: '300000000011111', konto: '1000', sort: 0 },
    { firmId: B, name: 'Трансакциска сметка', account: '210-0000000222-33', konto: '1000', sort: 0 },
  ]);
  await pg.insert(schema.yearClosings).values([{ firmId: B, year: Y, status: 'closed', entity: 'tp' }]);
  for (const [k, role, firms, demo] of [['owner', 'admin', [], false], ['acc', 'acc', [A, B], false], ['one', 'acc', [B, C], false], ['demo', 'admin', [D, E], true]] as const) {
    const id = await signIn(role, { username: `fg_${k}`, firms: [...firms], allFirms: role === 'admin' && !demo, demo });
    if (k === 'owner') { owner = id; await pg.update(schema.users).set({ createdAt: new Date('2000-01-01T00:00:00Z') }).where(eq(schema.users.id, id)); }
    S[k] = jar.get('wc_sess')!;
  }
  await pg.insert(schema.appSettings).values({ key: 'officeOwner', value: { id: owner } });
}, 120_000);

describe('„Избор на работна фирма“ grid', () => {
  it('lists the allowed firms with the old columns filled from the data', async () => {
    as('owner');
    const el = await picker();
    expect(el.props.uid).toBe(owner);
    const R = new Map(el.props.rows.map((r) => [r.id, r]));
    expect([...R.keys()].sort()).toEqual([A, B, C].sort()); // never a demo firm
    const a = R.get(A)!;
    const cell = (f: FpFirm) => Object.fromEntries(FG_COLS.map(([k, , g]) => [k, g(f)]));
    expect(cell(a)).toEqual({
      code: '3137', name: 'АЛФА МЕДИКА ДООЕЛ', year: String(Y), parent: '2098', bank: '300000000011111', activity: '86.230', ftype: 'Ф', closed: 'Н',
      bank2: '210000000000222', embs: '7000011', regNo: 'R-11', edb: '4030000000011', address: 'Ул. Илинден 1', phone: '02 3111 222', bankName: 'Комерцијална банка',
      payCode: '930', realBank: '300000000099911', bankEdb: '4030990000001', depositor: 'ДЕП', bankAcc: '100000000000001', opstina: 'Центар', opstina2: 'Скопје',
    });
    expect(cell(R.get(B)!)).toMatchObject({ code: '15', ftype: 'СТД', closed: 'Д', bank: '210-0000000222-33', bankName: '', parent: '' });
    // created in WISE this year: no Родител, empty columns stay (empty, not hidden)
    expect(cell(R.get(C)!)).toMatchObject({ code: '', parent: '', bank: '', closed: 'Н', ftype: 'Ф' });
    // the owner-only fee is never a grid column
    expect(FG_COLS.map(([k]) => k)).not.toContain('fee');

    const html = renderToStaticMarkup(createElement(FirmPicker, el.props as never));
    expect(html).toContain('id="fpGrid"');
    const heads = [...html.matchAll(/<th data-col="(\w+)"[^>]*>([^<]*)/g)].map((m) => m[2]!.replace(/ [▾▴]$/, ''));
    expect(heads).toEqual(['Шифра', 'Име на фирма', 'Година', 'Родител', 'Жиро сметка', 'Дејност', 'Ф/СТД', 'Заклуч.', 'Дополн. жиро', 'Матичен број', 'Рег. број',
      'Даночен бр', 'Адреса', 'Телефон', 'Банка', 'Код за п.', 'Реална жиро', 'Даночен бр. на б…', 'Депозитор на б…', 'Жиро с-ка на банка', 'Општина', 'Општина2']);
    // default sort Шифра (numeric, empty last): 15, 3137, (none)
    expect([...html.matchAll(/<tr data-id="([^"]+)"/g)].map((m) => m[1])).toEqual([B, A, C]);
    expect(html).toContain('86.230');
    expect(html).toMatch(/<tr data-id="[^"]+" aria-selected="true" class="r k"/);
  });

  it('the year before the imported year: the imported Родител is that year\'s шифра', async () => {
    as('owner');
    useYear(Y - 1);
    const el = await Home({ searchParams: Promise.resolve({}) }) as PickerEl;
    const a = el.props.rows.find((r) => r.id === A)!;
    expect(a.code).toBe('2098');
    expect(a.g?.parent).toBe('');
    expect(a.g?.year).toBe(String(Y - 1));
    // either code finds the firm
    expect(fgApply([a], '3137').map((f) => f.id)).toEqual([A]);
    expect(fgApply([a], '2098').map((f) => f.id)).toEqual([A]);
  });

  it('search filters by name, шифра, Родител, ЕДБ, ЕМБС or account', async () => {
    as('owner');
    const { rows } = (await picker()).props;
    const q = (s: string) => fgApply(rows, s).map((f) => f.id);
    expect(q('алфа')).toEqual([A]);
    expect(q('3137')).toEqual([A]);
    expect(q('2098')).toEqual([A]);
    expect(q('5030000000022')).toEqual([B]);
    expect(q('7000011')).toEqual([A]);
    expect(q('300000000011111')).toEqual([A]);
    expect(q('210000000022233')).toEqual([B]); // account without the dashes
    expect(q('нема-такво')).toEqual([]);
    // header click: by name, then descending
    expect(fgApply(rows, '', 'name').map((f) => f.id)).toEqual([A, B, C]);
    expect(fgApply(rows, '', 'name', true).map((f) => f.id)).toEqual([C, B, A]);
  });

  it('↑ ↓ move, Enter / double-click open the firm', async () => {
    expect(fgKey(0, 3, 'ArrowDown')).toEqual({ k: 1, open: false });
    expect(fgKey(2, 3, 'ArrowDown')).toEqual({ k: 2, open: false });
    expect(fgKey(0, 3, 'ArrowUp')).toEqual({ k: 0, open: false });
    expect(fgKey(1, 3, 'End')).toEqual({ k: 2, open: false });
    expect(fgKey(1, 3, 'Enter')).toEqual({ k: 1, open: true });
    expect(fgKey(0, 0, 'Enter')).toBeNull();
    expect(fgKey(0, 3, 'a')).toBeNull();
    // the rendered grid: every row opens on a double-click and the search box drives the keyboard (Enter → selectFirm)
    as('owner');
    const el = await picker();
    let tree: unknown = null;
    const Spy = (p: Parameters<typeof FirmPicker>[0]) => { tree = FirmPicker(p); return tree as ReactElement; };
    renderToStaticMarkup(createElement(Spy, el.props as Parameters<typeof FirmPicker>[0]));
    const all: ReactElement<Record<string, unknown>>[] = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === 'object' && 'props' in n) { all.push(n as ReactElement<Record<string, unknown>>); walk((n as ReactElement<{ children?: unknown }>).props.children); }
    };
    walk(tree);
    const trs = all.filter((n) => n.type === 'tr' && n.props['data-id']);
    expect(trs.length).toBe(3);
    for (const t of trs) expect(typeof t.props.onDoubleClick).toBe('function');
    const inp = all.find((n) => n.type === 'input' && n.props.id === 'fp_q')!;
    expect(typeof inp.props.onKeyDown).toBe('function');
  });

  it('access: only the allowed firms; demo users only demo firms', async () => {
    as('one');
    let el = await picker();
    expect(el.props.rows.map((r) => r.id).sort()).toEqual([B, C].sort()); // never A
    as('demo');
    el = await picker();
    expect(el.props.rows.map((r) => r.id).sort()).toEqual([D, E].sort());
  });

  it('book-only colleague: the grid without fees / monthly invoices / alerts', async () => {
    as('acc');
    const el = await picker();
    expect(el.props.book).toBe(true);
    expect(el.props.rows.map((r) => r.id).sort()).toEqual([A, B].sort());
    for (const r of el.props.rows) { expect(r.fee).toBe(0); expect(r.recNext).toBeNull(); expect(r.al).toBeNull(); }
    const html = renderToStaticMarkup(createElement(FirmPicker, el.props as never));
    expect(html).not.toContain('Надомест');
    expect(html).toContain('id="fpGrid"');
  });
});
