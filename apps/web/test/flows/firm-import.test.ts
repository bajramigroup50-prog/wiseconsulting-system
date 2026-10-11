/**
 * Workflow 11 — firms from Excel (Фирми › 📥 Увоз од Excel) with VAT columns, a re-import that changes the VAT period,
 * then „🔧 Поправка на увезени фирми“: Latin-keyboard names → Cyrillic and the ЕДБ the import kept as „Даночен број“.
 */
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { act, form, pg, setupDb, signIn } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));

const { readFirmsFile, importFirms } = await import('@/app/(app)/firmiImp/actions');
const { applyCyr } = await import('@/app/(app)/firmi/kirilica/actions');
const KirilicaPage = (await import('@/app/(app)/firmi/kirilica/page')).default;

const xlsx = (rows: unknown[][], name = 'firmi.xlsx') => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Фирми');
  return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], name);
};
const firmBy = async (name: string) => (await pg.select().from(schema.firms).where(eq(schema.firms.name, name)))[0];

beforeAll(async () => {
  await setupDb();
  await signIn('admin');
}, 120_000);

describe('flow 11 — firm import', () => {
  const HEAD = ['Шифра', 'Име на фирма', 'ЕДБ', 'Матичен број', 'Адреса', 'Град', 'ДДВ (да/не)', 'ДДВ период (месечно/тромесечно)'];

  it('imports firms with VAT status and period from the file', async () => {
    const P = await readFirmsFile(form({ file: xlsx([HEAD,
      ['101', 'АЛФА ТРЕЈД ДООЕЛ', '4030019000011', '7000011', 'ул. Македонија 1', 'Скопје', 'да', 'тромесечно'],
      ['102', 'БЕТА УСЛУГИ ДОО', '4030019000022', '7000022', 'бул. Илинден 5', 'Битола', 'не', ''],
      ['103', 'ГАМА ПРОМ ДООЕЛ', '4030019000033', '7000033', 'ул. Охридска 3', 'Охрид', 'да', 'месечно'],
    ]) }));
    expect(P.error).toBeUndefined();
    expect(P.rows).toHaveLength(3);
    expect(P.rows!.every((r) => !r.ex)).toBe(true);
    const r = await importFirms(P.rows!.map((x) => x.f), { ddv: false, profiles: false });
    expect(r.ok).toMatch(/Увезени 3 нови/);
    expect(await firmBy('АЛФА ТРЕЈД ДООЕЛ')).toMatchObject({ edb: '4030019000011', embs: '7000011', vatRegistered: true, vatPeriod: 'quarter' });
    expect(await firmBy('БЕТА УСЛУГИ ДОО')).toMatchObject({ vatRegistered: false });
    expect(await firmBy('ГАМА ПРОМ ДООЕЛ')).toMatchObject({ vatRegistered: true, vatPeriod: 'month' });
  });

  it('a re-import finds the existing firms and updates the VAT period / status', async () => {
    const P = await readFirmsFile(form({ file: xlsx([HEAD,
      ['101', 'АЛФА ТРЕЈД ДООЕЛ', '4030019000011', '7000011', '', '', 'да', 'месечно'],
      ['102', 'БЕТА УСЛУГИ ДОО', '4030019000022', '7000022', '', '', 'да', 'тромесечно'],
    ]) }));
    expect(P.rows!.map((r) => r.exName)).toEqual(['АЛФА ТРЕЈД ДООЕЛ', 'БЕТА УСЛУГИ ДОО']);
    const r = await importFirms(P.rows!.map((x) => x.f), { ddv: false, profiles: false });
    expect(r.ok).toMatch(/Увезени 0 нови фирми, дополнети 2/);
    expect(await firmBy('АЛФА ТРЕЈД ДООЕЛ')).toMatchObject({ vatPeriod: 'month', address: 'ул. Македонија 1' });
    expect(await firmBy('БЕТА УСЛУГИ ДОО')).toMatchObject({ vatRegistered: true, vatPeriod: 'quarter' });
    expect((await pg.select().from(schema.firms)).length).toBe(3);
  });

  it('„Поправка на увезени фирми“: Latin-keyboard text → Cyrillic, ЕДБ from „Даночен број“', async () => {
    // an export of another program: Latin keyboard, the tax number under „Даночен број“
    const P = await readFirmsFile(form({ file: xlsx([['Име на фирма', 'Даночен број', 'Адреса', 'Град'], ['TRGOVIJA [UMA DOOEL', '4030019000044', 'ul. ;ar[ija 7', 'Skopje']]) }));
    await importFirms(P.rows!.map((x) => x.f), { ddv: false, profiles: false });
    expect((await firmBy('TRGOVIJA [UMA DOOEL'))!.edb).toBe('4030019000044');
    // firms brought in by the earlier import kept „Даночен број“ as the bank's tax number (settings.bankEdb)
    await pg.update(schema.firms).set({ edb: null, settings: { bankEdb: '4030019000044' } }).where(eq(schema.firms.name, 'TRGOVIJA [UMA DOOEL'));
    const raw = (await firmBy('TRGOVIJA [UMA DOOEL'))!;
    const html = renderToStaticMarkup(await KirilicaPage({ searchParams: Promise.resolve({}) }));
    const val = (n: string) => new RegExp(`name="${n.replace('.', '\\.')}" value="([^"]*)"`).exec(html)?.[1];
    expect(val(`name.${raw.id}`)).toBe('ТРГОВИЈА ШУМА ДООЕЛ');
    expect(val(`address.${raw.id}`)).toBe('ул. чаршија 7');
    expect(val(`city.${raw.id}`)).toBe('Скопје');
    expect(val(`edb.${raw.id}`)).toBe('4030019000044');
    expect(html).not.toContain('АЛФА ТРЕЈД'); // Cyrillic firms with an ЕДБ are not listed
    const r = await act(applyCyr(form({ pick: [raw.id], [`name.${raw.id}`]: val(`name.${raw.id}`)!, [`address.${raw.id}`]: val(`address.${raw.id}`)!, [`city.${raw.id}`]: val(`city.${raw.id}`)!, [`edb.${raw.id}`]: val(`edb.${raw.id}`)! })));
    expect(r).toEqual({ redirect: '/firmi/kirilica?done=1' });
    const [f] = await pg.select().from(schema.firms).where(eq(schema.firms.id, raw.id));
    expect(f).toMatchObject({ name: 'ТРГОВИЈА ШУМА ДООЕЛ', address: 'ул. чаршија 7', city: 'Скопје', edb: '4030019000044' });
    const A = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, raw.id));
    expect(A.map((a) => a.action)).toEqual(expect.arrayContaining(['newFirm', 'saveFirm']));
  });
});
