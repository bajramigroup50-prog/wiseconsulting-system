/**
 * Финансово › „Аналитика“ (`/akart`, the old program's analytic card workflow) and the Бруто биланс – рекапитулар on
 * PGlite with synthetic data: the konto list (search data, „Само конта со книжење“), a partner konto → its partners
 * (sums, доспеано, доцни ден., Салдо ПС, Активни / Пасивни / Сите), the partner card with previous / next partner
 * (F4 / F5), a konto without partners → its card directly, Девизна; the trial balance tabs / parameters → „Аналитика“.
 */
import { prerender } from 'react-dom/static';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { postJournal, schema } from '@wise/db';
import { jar, pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push() {}, refresh() {}, back() {} }) }));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const AkartPage = (await import('@/app/(app)/akart/page')).default;
const BilancPage = (await import('@/app/(app)/bilanc/page')).default;
const { NAV } = await import('@/lib/nav');
const PrintZbir = (await import('@/app/print/kkart/zbir/page')).default;
const PrintFin = (await import('@/app/print/fin/[doc]/page')).default;
const PrintBilanc = (await import('@/app/print/bilanc/page')).default;

const html = async (el: React.ReactNode) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, '');
const ak = async (sp: Record<string, string> = {}) => html(await AkartPage({ searchParams: Promise.resolve(sp) }));
const bb = async (sp: Record<string, string> = {}) => html(await BilancPage({ searchParams: Promise.resolve(sp) }));
const per = { from: '2026-01-01', to: '2026-06-30' };
const P: Record<string, string> = {};

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'Аналитика Тест ДООЕЛ' }).returning();
  const firmId = f!.id;
  for (const [code, name, bank] of [['101', 'Алфа ДОО', '300000000000101'], ['102', 'Бета ДООЕЛ', ''], ['103', 'Гама АД', '']] as const) {
    const [p] = await pg.insert(schema.partners).values({ firmId, code, name, city: 'Скопје', edb: '40300000' + code, bankAccount: bank || null }).returning();
    P[code] = p!.id;
  }
  const post = (date: string, kind: string, lines: Parameters<typeof postJournal>[1]['lines'], number?: string) =>
    pg.transaction((tx) => postJournal(tx as never, { firmId, date, kind: kind as never, number, description: 'Тест ' + date, userId: null, lines }));
  await post('2026-01-01', 'open', [{ account: '1020', debit: 1000 }, { account: '2200', credit: 1000, partnerId: P['101'] }], '0');
  await post('2026-02-01', 'manual', [{ account: '4000', debit: 500 }, { account: '2200', credit: 500, partnerId: P['102'], doc: 'Ф-12' }], '2-1');
  await post('2026-02-05', 'manual', [{ account: '4000', debit: 200 }, { account: '2200', credit: 200, partnerId: P['103'] }], '2-2');
  await post('2026-03-01', 'manual', [{ account: '2200', debit: 200, partnerId: P['103'] }, { account: '1020', credit: 200 }], '3-1');
  await post('2026-03-10', 'manual', [{ account: '2200', debit: 400, partnerId: P['101'], currency: 'EUR', amountCur: 6.5 }, { account: '1020', credit: 400 }], '3-2');
  await signIn('admin');
  useFirm(firmId); useYear(2026);
}, 120_000);

describe('„Аналитика“ (/akart)', () => {
  it('is the first item of Финансово', () => {
    expect(NAV.find(([g]) => g === 'Финансово')![1][0]).toEqual(['akart', 'Аналитика']);
  });

  it('1. konto list: chart kontos with turnover, search data (code / name), the old program\'s buttons', async () => {
    const h = await ak(per);
    expect(h).toContain('Избор на конто за аналитика');
    expect(h).toContain('id="akK"');
    expect(h).toContain('data-k="2200"');
    expect(h).toMatch(/data-href="\/akart\?k=2200&amp;from=2026-01-01&amp;to=2026-06-30"/);
    expect(h).not.toContain('data-k="7600"'); // no bookings → hidden by „Само конта со книжење“
    for (const b of ['ИЗБОР (Enter) денарска', 'Девизна (F5)', 'Денарско-девизна (F4)', 'ИОС', 'Девизен ИОС', 'Синтетичка картица', 'Промена на период (F6)', 'Групен избор (F7)']) expect(h).toContain(b);
    expect(h).toContain('data-filter=""');
    expect(await ak({ ...per, post: '0' })).toContain('data-k="7600"');
  });

  it('2. a partner konto lists its partners with sums, Салдо ПС and Активни / Пасивни / Сите', async () => {
    const h = await ak({ ...per, k: '2200' });
    expect(h).toContain('id="akP"');
    for (const c of ['Шифра', 'Должи', 'Побарува', 'Салдо', 'Доспеан износ', 'Доцни ден.', 'Салдо ПС', 'Жиро с-ка', 'ЕДБ / ЕМБС', 'Адреса']) expect(h).toContain(`>${c}<`);
    expect(h).toContain('Алфа ДОО');
    expect(h).toContain('Бета ДООЕЛ');
    expect(h).not.toContain('Гама АД'); // closed → not active
    expect(h).toContain('-600,00'); // Алфа: 1000 credit opening − 400 paid
    expect(h).toContain('-1.000,00'); // Салдо ПС of Алфа
    expect(h).toContain('-1.100,00'); // footer saldo of the list (−600 −500)
    expect(h).toContain('Вкупно 2');
    // Алфа: opening 1000 due 01.01, 400 paid → 600 overdue on 30.06 (180 days); Бета 500 from 01.02 (149 days)
    expect(h).toMatch(/600,00<\/td><td class="n">180</);
    expect(h).toMatch(/500,00<\/td><td class="n">149</);
    const pas = await ak({ ...per, k: '2200', f: 'p' });
    expect(pas).toContain('Гама АД');
    expect(pas).not.toContain('Алфа ДОО');
    const all = await ak({ ...per, k: '2200', f: 's' });
    expect(all.indexOf('Алфа ДОО')).toBeLessThan(all.indexOf('Бета ДООЕЛ'));
    expect(all.indexOf('Бета ДООЕЛ')).toBeLessThan(all.indexOf('Гама АД'));
  });

  it('3. the partner card: header, lines, totals; F4 / F5 walk the list (the first has no previous)', async () => {
    const h = await ak({ ...per, k: '2200', pid: P['101']!, f: 's' });
    expect(h).toContain('id="akC"');
    expect(h).toContain('Аналитика Тест ДООЕЛ');
    expect(h).toContain('<b>101</b> Алфа ДОО');
    expect(h).toContain('Жиро 300000000000101');
    expect(h).toContain('(1 / 3)');
    expect(h).toContain('Вк. сума должи / побарува / салдо');
    expect(h).toMatch(/<span class="btn sm disabled">← Претх\. комит\. \(F4\)/);
    expect(h).toContain(`href="/akart?k=2200&amp;pid=${P['102']}&amp;from=2026-01-01&amp;to=2026-06-30&amp;f=s"`); // Следен комит. (F5)
    expect(h).toContain('600,00<span class="dp">П</span>');
    for (const b of ['Групно по изводи', 'Печатење (F2)', 'Преглед на содржина (F3)', 'Излез (Esc)']) expect(h).toContain(b);
    expect(h).toContain('data-href="/nalozi?n=3-2"');
    const mid = await ak({ ...per, k: '2200', pid: P['102']!, f: 's' });
    expect(mid).toContain(`pid=${P['101']}`);
    expect(mid).toContain(`pid=${P['103']}`);
    expect(mid).toContain('(2 / 3)');
    expect(mid).toContain('Ф-12');
    const last = await ak({ ...per, k: '2200', pid: P['103']!, f: 's' });
    expect(last).toMatch(/<span class="btn sm disabled">Следен комит\. \(F5\)/);
  });

  it('Девизна / Денарско-девизна: the foreign amount and saldo of the lines', async () => {
    const v = await ak({ ...per, k: '2200', pid: P['101']!, m: 'v' });
    expect(v).toContain('>Дев. износ<');
    expect(v).toContain('EUR');
    expect(v).toContain('6,50');
    expect(v).not.toContain('>Салдо Д / П<');
    const dv = await ak({ ...per, k: '2200', pid: P['101']!, m: 'dv' });
    expect(dv).toContain('>Салдо Д / П<');
    expect(dv).toContain('>Дев. салдо<');
  });

  it('a konto without partners opens its card directly (no partner list, no F4 / F5)', async () => {
    const h = await ak({ ...per, k: '1020' });
    expect(h).not.toContain('id="akP"');
    expect(h).toContain('id="akC"');
    expect(h).not.toContain('Претх. комит.');
    expect(h).toContain('ПОЧЕТНО САЛДО');
    expect(h).toContain('400,00<span class="dp">Д</span>'); // 1000 − 200 − 400
  });
});

describe('Бруто биланс – рекапитулар', () => {
  it('tabs, parameters, print buttons; rows open „Аналитика“', async () => {
    const h = await bb(per);
    for (const t of ['Класи', 'Групи', 'Синтетики (3)', 'Синтетики (4)', 'Синтетики (5)', 'Аналитики', 'Вкупно', 'Префикс', 'Суфикс', 'Од конто', 'До конто',
      'Без колона „Само од тековна година“', 'Печатење (F2)', 'Печатење Landscape', 'Скратено печатење (F3)', 'Скратено печатење Landscape', 'Збирна аналитичка картица (F5)']) expect(h).toContain(t);
    expect(h).toContain('data-href="/akart?k=2200&amp;from=2026-01-01&amp;to=2026-06-30"');
    const f = await bb({ ...per, kf: '2000', kt: '2999' });
    expect(f).toContain('data-k="2200"');
    expect(f).not.toContain('data-k="1020"');
    expect(f).toContain('kf=2000');
    const g = await bb({ ...per, lvl: '2' });
    expect(g).toContain('data-k="22"');
    const v = await bb({ ...per, lvl: 'v' });
    expect(v).not.toContain('class="bbrow"');
    const n = await bb({ ...per, nocur: '1' });
    expect(n).not.toContain('>Должи од тек. година<');
  });

  it('prints: збирна аналитичка картица of the range, скратено / portrait, девизен ИОС', async () => {
    const z = await html(await PrintZbir({ searchParams: Promise.resolve({ ...per, pre: '2' }) }));
    expect(z).toContain('ЗБИРНА АНАЛИТИЧКА КАРТИЦА');
    expect(z).toContain('КОНТО 2200');
    expect(z).not.toContain('КОНТО 1020');
    const s = await html(await PrintBilanc({ searchParams: Promise.resolve({ ...per, lvl: '4', short: '1', or: 'p' }) }));
    expect(s).toContain('(скратено)');
    expect(s).toContain('size:A4 portrait');
    expect(s).not.toContain('Поч. сост. должи');
    const n = await html(await PrintBilanc({ searchParams: Promise.resolve({ ...per, nocur: '1', kom: '0' }) }));
    expect(n).not.toContain('Само од тековна година');
    expect(n).toContain('size:A4 landscape');
    const ios = await html(await PrintFin({ params: Promise.resolve({ doc: 'ios' }), searchParams: Promise.resolve({ pid: P['101']!, cur: '1' }) }));
    expect(ios).toContain('Девизен износ');
    expect(ios).toContain('Салдо во EUR');
  });
});
