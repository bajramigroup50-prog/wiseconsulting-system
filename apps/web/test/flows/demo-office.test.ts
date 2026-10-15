/**
 * 🎭 Demo office views: a demo ADMIN (owner of the sandboxed demo office) opens the office / owner views of
 * `DEMO_OFFICE_VIEWS` and sees ONLY demo data (demo firms, demo users, the demo office „ДЕМО СМЕТКОВОДСТВО ДООЕЛ“) —
 * never a real firm, a real colleague, a real contract or the real office (БАЈРАМИ ГРОУП); forged ids of real rows are
 * refused by every action; the real office profile is never written; `isOfficeOwner` stays false. And the mirror
 * image: the real owner never sees a demo firm, demo user or demo row in the same views.
 */
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_OFF_MSG } from '@wise/core/demo';
import { schema } from '@wise/db';
import { act, form, jar, pg, setupDb, signIn, useFirm } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@/lib/jobs', () => ({ enqueue: async () => 'job', renderPdf: async () => 'x' }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const { DEMO_OFFICE_VIEWS, demoVerdict } = await import('@/lib/route-guard');
const { demoNavViews, isDemoOwner } = await import('@/lib/demo-office');
const { isOfficeOwner } = await import('@/lib/office-owner');
const { getUser } = await import('@/lib/auth');

const Pages = {
  aktivnost: (await import('@/app/(app)/aktivnost/page')).default,
  produktivnost: (await import('@/app/(app)/produktivnost/page')).default,
  kdogovori: (await import('@/app/(app)/kdogovori/page')).default,
  kdfakturi: (await import('@/app/(app)/kdfakturi/page')).default,
  firmIzv: (await import('@/app/(app)/firmIzv/page')).default,
  rokovi: (await import('@/app/(app)/rokovi/page')).default,
  mesIzv: (await import('@/app/(app)/mesIzv/page')).default,
  kanc: (await import('@/app/(app)/kanc/page')).default,
  mojzad: (await import('@/app/(app)/mojzad/page')).default,
  klInbox: (await import('@/app/(app)/klInbox/page')).default,
  aiTrosok: (await import('@/app/(app)/aiTrosok/page')).default,
};
const KdPrint = (await import('@/app/(print)/kdogovori/pecati/page')).default;
const ProdXlsx = await import('@/app/(app)/produktivnost/xlsx/route');
const FiWord = await import('@/app/(app)/firmIzv/word/route');
const KD = await import('@/app/(app)/kdogovori/actions');
const KF = await import('@/app/(app)/kdfakturi/actions');
const FI = await import('@/app/(app)/firmIzv/actions');
const RK = await import('@/app/(app)/rokovi/actions');
const MI = await import('@/app/(app)/mesIzv/actions');
const KC = await import('@/app/(app)/kanc/actions');
const KI = await import('@/app/(app)/klInbox/actions');
const AI = await import('@/app/(app)/aiTrosok/actions');
const PR = await import('@/app/(app)/produktivnost/actions');
const { loadProductivity, prodFilter } = await import('@/app/(app)/produktivnost/data');

const S: Record<string, string> = {};
const ID: Record<string, string> = {};
const as = (who: string) => { jar.set('wc_sess', S[who]!); jar.delete('wc_fid'); };
const html = async (el: Promise<React.ReactElement> | React.ReactElement) => renderToStaticMarkup(await el);
const sp = <T extends object>(o: T) => ({ searchParams: Promise.resolve(o) });
const Y = new Date().getFullYear();
const YM = `${Y}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

/** Every marker of the real office: firms, colleagues, contract, task, message, AI purpose, the office profile. */
const REAL = ['БАЈРАМИ', 'РЕАЛНА ФИРМА', 'REALOWNER', 'REALCOLLEAGUE', 'СУ-077/', 'РЕАЛНА ЗАДАЧА', 'РЕАЛНА ПОРАКА', 'realAction', 'office@bajrami.mk', 'Реален Застапник'];
/** Markers of the demo office. */
const DEMO = ['ДЕМО ТРГОВИЈА', 'DEMOADMIN', 'DEMOCOLLEAGUE', 'ДЕМО-СУ-001/', 'ДЕМО ЗАДАЧА', 'ДЕМО ПОРАКА', 'demoAction', 'ДЕМО СМЕТКОВОДСТВО'];
const noReal = (h: string, where: string) => { for (const x of REAL) expect(h, `${where}: ${x}`).not.toContain(x); };
const noDemo = (h: string, where: string) => { for (const x of DEMO) expect(h, `${where}: ${x}`).not.toContain(x); };

const OFFICE = { name: 'БАЈРАМИ ГРОУП ДООЕЛ Скопје', edb: '4030000000001', email: 'office@bajrami.mk', rep: 'Реален Застапник', lic: 'REAL-LIC', rok: { days: 5, mail: true }, feeInv: { auto: true, mail: true, remind: { on: true, days: 10, every: 15, max: 3 } } };

beforeAll(async () => {
  await setupDb();
  const [ro, rf, df, dof] = await pg.insert(schema.firms).values([
    { name: 'БАЈРАМИ ГРОУП ДООЕЛ Скопје', edb: '4030000000001', settings: { officeFirm: true } },
    { name: 'РЕАЛНА ФИРМА ЕДЕН ДОО', edb: '4030000000002', email: 'real@firma.mk', settings: { kdog: { no: 'СУ-077/2026', fee: 5000, st: 'потпишан' }, accFee: 5000 } },
    { name: 'ДЕМО ТРГОВИЈА ДООЕЛ', edb: '4099000000001', settings: { demo: true, kdog: { no: 'ДЕМО-СУ-001/2026', fee: 3000, st: 'потпишан' }, accFee: 3000 } },
    { name: 'ДЕМО СМЕТКОВОДСТВО ДООЕЛ', edb: '4099000000009', settings: { demo: true, demoOffice: true } },
  ]).returning();
  ID.realOffice = ro!.id; ID.real = rf!.id; ID.demo = df!.id; ID.demoOffice = dof!.id;
  await pg.insert(schema.appSettings).values({ key: 'office', value: OFFICE });

  for (const [k, role, demo] of [['REALOWNER', 'admin', false], ['REALCOLLEAGUE', 'acc', false], ['DEMOADMIN', 'admin', true], ['DEMOCOLLEAGUE', 'acc', true]] as const) {
    ID[k] = await signIn(role, { username: k, demo, ...(role === 'acc' && !demo ? { firms: [ID.real!] } : {}) });
    if (k === 'REALOWNER') await pg.update(schema.users).set({ createdAt: new Date('2000-01-01T00:00:00Z') }).where(eq(schema.users.id, ID[k]!));
    S[k] = jar.get('wc_sess')!;
  }
  await pg.insert(schema.serviceContracts).values([
    { firmId: ID.real!, number: 'СУ-077/2026', date: '2026-01-10', fee: '5000', status: 'signed', data: { rep: 'Реален Застапник', fee: 5000 } },
    { firmId: ID.demo!, number: 'ДЕМО-СУ-001/2026', date: '2026-01-10', fee: '3000', status: 'signed', data: { rep: 'Демо Застапник', fee: 3000 } },
  ]);
  const [rt, dt] = await pg.insert(schema.officeTasks).values([
    { title: 'РЕАЛНА ЗАДАЧА', type: 'Друго', inst: 'Друго', createdBy: ID.REALOWNER, assigneeId: null, status: 'new' },
    { title: 'ДЕМО ЗАДАЧА', type: 'Друго', inst: 'Друго', firmId: ID.demo, createdBy: ID.DEMOADMIN, assigneeId: null, status: 'new' },
  ]).returning();
  ID.realTask = rt!.id; ID.demoTask = dt!.id;
  const now = new Date();
  await pg.insert(schema.auditLog).values([
    { at: now, userId: ID.REALOWNER, firmId: ID.real, action: 'realAction', entityType: 'invoice', data: { note: 'РЕАЛНА ФИРМА' } },
    { at: now, userId: ID.REALCOLLEAGUE, firmId: null, action: 'realAction' },
    { at: now, userId: null, firmId: ID.real, action: 'realAction' },
    // a real user who touched a demo firm: shown to nobody of the demo (a real name)
    { at: now, userId: ID.REALOWNER, firmId: ID.demo, action: 'realAction' },
    { at: now, userId: ID.DEMOADMIN, firmId: ID.demo, action: 'demoAction', entityType: 'invoice' },
    { at: now, userId: ID.DEMOCOLLEAGUE, firmId: null, action: 'demoAction' },
    // an orphaned seeded demo row (after a reset: no user / firm), tagged
    { at: now, userId: null, firmId: null, action: 'demoAction', entityType: 'demo', data: { demo: true } },
  ]);
  await pg.insert(schema.inboxItems).values([
    { firmId: ID.real!, fromOffice: false, subject: 'РЕАЛНА ПОРАКА', fromName: 'REALCLIENT' },
    { firmId: ID.demo!, fromOffice: false, subject: 'ДЕМО ПОРАКА', fromName: 'Демо клиент' },
  ]);
  await pg.insert(schema.aiUsage).values([
    { firmId: ID.real, purpose: 'realpurpose', tier: 'default', model: 'real-model', costUsd: '1.5' },
    { firmId: ID.demo, purpose: 'demo:purchase', tier: 'default', model: 'demo-model', costUsd: '0.25' },
    { firmId: null, purpose: 'demo:orphan', tier: 'default', model: 'demo-orphan-model', costUsd: '0.1' },
  ] as never);
}, 180_000);

describe('🎭 demo office — allow-list and owner context', () => {
  it('the enabled office views pass the demo route guard and stay in the demo menu', async () => {
    expect(DEMO_OFFICE_VIEWS).toEqual(expect.arrayContaining(Object.keys(Pages)));
    for (const v of DEMO_OFFICE_VIEWS) {
      expect(demoVerdict(`/${v}`), v).toBeNull();
      expect(demoNavViews(), v).toContain(v);
    }
    // the print views of the owner reports are not in the demo print allow-list
    expect(demoVerdict('/print/produktivnost')).toBe('/');
    expect(demoVerdict('/api/office/tpl/own')).toBe('403');
  });

  it('a demo admin is the demo owner, never the office owner', async () => {
    as('DEMOADMIN');
    const u = await getUser();
    expect(u?.demo).toBe(true);
    expect(isDemoOwner(u)).toBe(true);
    expect(await isOfficeOwner(u)).toBe(false);
    as('REALOWNER');
    expect(await isOfficeOwner(await getUser())).toBe(true);
    expect(isDemoOwner(await getUser())).toBe(false);
  });
});

describe('🎭 demo admin sees only demo data in every enabled view', () => {
  it('aktivnost', async () => {
    as('DEMOADMIN');
    const h = await html(Pages.aktivnost(sp({})));
    noReal(h, 'aktivnost');
    expect(h).toContain('demoAction');
    expect(h).toContain('DEMOCOLLEAGUE'); // the per-user filter of the demo owner lists demo users
    // a forged firm filter of a real firm shows nothing of it
    noReal(await html(Pages.aktivnost(sp({ f: ID.real }))), 'aktivnost f=real');
    noReal(await html(Pages.aktivnost(sp({ u: ID.REALOWNER }))), 'aktivnost u=real');
  });

  it('produktivnost (page, loader, Excel)', async () => {
    as('DEMOADMIN');
    const h = await html(Pages.produktivnost(sp({ p: 'month' })));
    noReal(h, 'produktivnost');
    expect(h).toContain('DEMOCOLLEAGUE');
    const D = await loadProductivity(prodFilter({ p: 'month' }), await getUser());
    expect(D.userList.map((x) => x.name).sort()).toEqual(['DEMOADMIN', 'DEMOCOLLEAGUE']);
    expect(D.firmList.every((f) => f.name.startsWith('ДЕМО'))).toBe(true);
    expect([...D.report.users.map((w) => w.userId)].every((x) => x === null || x === ID.DEMOADMIN || x === ID.DEMOCOLLEAGUE)).toBe(true);
    const r = await ProdXlsx.GET(new Request('http://localhost/produktivnost/xlsx?p=month'));
    expect(r.status).toBe(200);
    expect(await PR.transferOwner({}, form({ to: ID.REALOWNER, ok: true }))).toHaveProperty('error');
  });

  it('kdogovori: demo office provider, demo clients, demo contracts; real ids refused; office profile untouched', async () => {
    as('DEMOADMIN');
    useFirm(ID.real!); // a forged current-firm cookie of a real firm changes nothing
    const h = await html(Pages.kdogovori(sp({ f: ID.demo })));
    noReal(h, 'kdogovori');
    expect(h).toContain('ДЕМО СМЕТКОВОДСТВО ДООЕЛ');
    expect(h).toContain('ДЕМО-СУ-001/');
    noReal(await html(Pages.kdogovori(sp({ f: ID.real }))), 'kdogovori f=real');
    noReal(await html(Pages.kdogovori(sp({ f: ID.realOffice }))), 'kdogovori f=office');
    const contract = JSON.stringify({ date: `${Y}-03-01`, place: 'Скопје', fee: 1000, feeMode: 'gross', rep: 'Демо Застапник', repRole: 'Управител' });
    expect(await KD.saveContract(ID.real!, contract)).toHaveProperty('error');
    expect(await KD.saveContract(ID.realOffice!, contract)).toHaveProperty('error');
    const ok = await KD.saveContract(ID.demo!, contract);
    expect(ok).toHaveProperty('ok');
    const [c] = await pg.select().from(schema.serviceContracts).where(eq(schema.serviceContracts.id, (ok as { id: string }).id));
    expect(c!.number).toMatch(/^ДЕМО-СУ-\d{3}\//);
    expect(JSON.stringify(c!.data)).not.toContain('БАЈРАМИ');
    // forged contract ids of the real office
    const [real] = await pg.select().from(schema.serviceContracts).where(eq(schema.serviceContracts.firmId, ID.real!));
    for (const r of [KD.officeSign(ID.demo!, real!.id), KD.deleteContract(ID.real!, real!.id), KD.endContract(ID.real!, real!.id), KD.contractToDossier(ID.real!, real!.id)]) expect(await r).toHaveProperty('error');
    expect((await pg.select().from(schema.serviceContracts).where(eq(schema.serviceContracts.id, real!.id)))[0]!.status).toBe('signed');
    expect(await KD.mailContract({}, form({ firmId: ID.demo, id: c!.id, to: 'x@example.mk' }))).toEqual({ error: DEMO_OFF_MSG });
    expect(await KD.setOfficeFirm({}, form({ officeFirmId: ID.real }))).toEqual({ error: DEMO_OFF_MSG });
    // office settings: the demo office's copy only
    expect(await KD.saveOffice({}, form({ lic: 'DEMO-LIC', fee: 999, docDay: 5, feeMode: 'gross' }))).toHaveProperty('ok');
    const [o] = await pg.select().from(schema.appSettings).where(eq(schema.appSettings.key, 'office'));
    expect(o!.value).toEqual(OFFICE);
    const [d] = await pg.select().from(schema.appSettings).where(eq(schema.appSettings.key, 'demoOffice'));
    expect((d!.value as { lic?: string }).lic).toBe('DEMO-LIC');
    expect(JSON.stringify(d!.value)).not.toContain('БАЈРАМИ');
    // print: a demo contract yes, a real one never
    noReal(await html(KdPrint(sp({ id: c!.id }))), 'kd print');
    await expect(KdPrint(sp({ id: real!.id }))).rejects.toThrow();
    // monthly invoices from the contracts: in the demo office firm only
    expect(await KD.syncRecurring()).toHaveProperty('ok');
    const rec = await pg.select().from(schema.recurringInvoices);
    expect(rec.every((r) => r.firmId === ID.demoOffice)).toBe(true);
  });

  it('kdfakturi: the demo office invoices demo firms only; delivery / reminders / real settings off', async () => {
    as('DEMOADMIN');
    const h = await html(Pages.kdfakturi(sp({ m: YM })));
    noReal(h, 'kdfakturi');
    expect(h).toContain('ДЕМО СМЕТКОВОДСТВО ДООЕЛ');
    const r = await KF.issueFeeAction({}, form({ ym: YM, date: `${YM}-28`, only: [ID.real!, ID.demo!] }));
    expect(JSON.stringify(r)).not.toContain('РЕАЛНА');
    const fees = await pg.select().from(schema.feeInvoices);
    expect(fees.every((f) => f.officeFirmId === ID.demoOffice && f.clientFirmId === ID.demo)).toBe(true);
    if (fees[0]) {
      expect(await KF.remindFeeAction(fees[0].id)).toEqual({ error: DEMO_OFF_MSG });
      expect(await KF.redeliverFeeAction(fees[0].id)).toEqual({ error: DEMO_OFF_MSG });
    }
    expect(await KF.saveFeeSettings({}, form({ day: 'L', auto: true, mail: true, rOn: true }))).toHaveProperty('ok');
    expect((await pg.select().from(schema.appSettings).where(eq(schema.appSettings.key, 'office')))[0]!.value).toEqual(OFFICE);
    const d = (await pg.select().from(schema.appSettings).where(eq(schema.appSettings.key, 'demoOffice')))[0]!.value as { feeInv?: { auto?: boolean; mail?: boolean } };
    expect(d.feeInv?.auto).toBe(false);
    expect(d.feeInv?.mail).toBe(false);
  });

  it('firmIzv: demo firms only (page, Word, AI action)', async () => {
    as('DEMOADMIN');
    const h = await html(Pages.firmIzv(sp({ f: ID.demo, y: String(Y) })));
    noReal(h, 'firmIzv demo');
    expect(h).toContain('ДЕМО ТРГОВИЈА');
    const h2 = await html(Pages.firmIzv(sp({ f: ID.real, y: String(Y) })));
    noReal(h2, 'firmIzv real id');
    expect(h2).toContain('Фирмата не постои');
    expect((await FiWord.GET(new Request(`http://localhost/firmIzv/word?f=${ID.real}&y=${Y}`))).status).toBe(404);
    expect(await FI.firmReportAiAction(ID.real!, Y, null)).toHaveProperty('error');
  });

  it('rokovi: demo firms and demo colleagues only; reminder settings off; real deadline ids refused', async () => {
    as('DEMOADMIN');
    const h = await html(Pages.rokovi(sp({ v: 'lista', m: YM })));
    noReal(h, 'rokovi');
    expect(h).not.toContain('⚙ Потсетници');
    as('REALOWNER');
    await html(Pages.rokovi(sp({ v: 'lista', m: YM }))); // generates the real firms' deadlines
    const [realRok] = await pg.select().from(schema.rokovi).where(eq(schema.rokovi.firmId, ID.real!)).limit(1);
    as('DEMOADMIN');
    if (realRok) {
      expect(await RK.markRokAction(realRok.id, true)).toHaveProperty('error');
      expect((await pg.select().from(schema.rokovi).where(eq(schema.rokovi.id, realRok.id)))[0]!.done).toBe(false);
    }
    expect(await RK.saveRokSettings({}, form({ days: 1, mail: true }))).toEqual({ error: DEMO_OFF_MSG });
    expect((await pg.select().from(schema.appSettings).where(eq(schema.appSettings.key, 'office')))[0]!.value).toEqual(OFFICE);
    expect(await RK.syncRokAction(YM)).toHaveProperty('ok');
  });

  it('mesIzv: demo firms only; no e-mail', async () => {
    as('DEMOADMIN');
    noReal(await html(Pages.mesIzv(sp({}))), 'mesIzv');
    const prev = `${Y}-01`;
    expect(await MI.prepareAll({}, form({ period: prev }))).toHaveProperty('ok');
    const R = await pg.select().from(schema.clientReports);
    expect(R.length).toBeGreaterThan(0);
    expect(R.every((r) => r.firmId === ID.demo || r.firmId === ID.demoOffice)).toBe(true);
    expect(await MI.mailClientReport({}, form({ id: R[0]!.id, to: 'x@example.mk' }))).toEqual({ error: DEMO_OFF_MSG });
    useFirm(ID.demo!);
    noReal(await html(Pages.mesIzv(sp({}))), 'mesIzv firm');
  });

  it('kanc + mojzad: demo tasks / colleagues / firms only; forged real ids refused', async () => {
    as('DEMOADMIN');
    const h = await html(Pages.kanc(sp({ st: 'all', nov: '' })));
    noReal(h, 'kanc');
    expect(h).toContain('ДЕМО ЗАДАЧА');
    expect(h).toContain('DEMOCOLLEAGUE');
    noReal(await html(Pages.kanc(sp({ st: 'all', t: ID.realTask }))), 'kanc t=real');
    noReal(await html(Pages.mojzad()), 'mojzad');
    expect(await KC.saveTask({}, form({ title: 'X', firmId: ID.real }))).toHaveProperty('error');
    expect(await KC.saveTask({}, form({ title: 'X', assigneeId: ID.REALCOLLEAGUE }))).toHaveProperty('error');
    expect(await KC.saveTask({}, form({ title: 'X', id: ID.realTask }))).toHaveProperty('error');
    expect(await KC.setTaskStatus(ID.realTask!, 'done')).toHaveProperty('error');
    expect(await KC.terenAction(ID.realTask!, 'take')).toHaveProperty('error');
    await act(KC.deleteTask(ID.realTask!));
    const [rt] = await pg.select().from(schema.officeTasks).where(eq(schema.officeTasks.id, ID.realTask!));
    expect(rt).toBeTruthy();
    expect(rt!.status).toBe('new');
    expect(rt!.title).toBe('РЕАЛНА ЗАДАЧА');
    // a new task by the demo admin, assigned to a demo colleague, is a demo task
    const r = await act(KC.saveTask({}, form({ title: 'НОВА ДЕМО', firmId: ID.demo, assigneeId: ID.DEMOCOLLEAGUE })));
    expect(r).toHaveProperty('redirect');
    expect(await html(Pages.kanc(sp({ st: 'all' })))).toContain('НОВА ДЕМО');
    expect(await KC.setTaskStatus(ID.demoTask!, 'progress')).toHaveProperty('ok');
  });

  it('klInbox: demo firms only; no e-mail', async () => {
    as('DEMOADMIN');
    const h = await html(Pages.klInbox(sp({})));
    noReal(h, 'klInbox');
    expect(h).toContain('ДЕМО ПОРАКА');
    noReal(await html(Pages.klInbox(sp({ firm: ID.real }))), 'klInbox firm=real');
    const [ri] = await pg.select().from(schema.inboxItems).where(eq(schema.inboxItems.subject, 'РЕАЛНА ПОРАКА'));
    expect(await KI.routeInbox({}, form({ id: ri!.id }))).toHaveProperty('error');
    expect((await pg.select().from(schema.inboxItems).where(eq(schema.inboxItems.id, ri!.id)))[0]!.done).toBe(false);
    expect(await KI.replyToClient({}, form({ firmId: ID.real, note: 'x' }))).toHaveProperty('error');
    expect(await KI.replyToClient({}, form({ firmId: ID.demo, note: 'здраво' }))).toHaveProperty('ok');
    expect((await pg.select().from(schema.mailLog)).length).toBe(0);
  });

  it('aiTrosok: demo firms only, read-only', async () => {
    as('DEMOADMIN');
    const h = await html(Pages.aiTrosok(sp({})));
    noReal(h, 'aiTrosok');
    expect(h).not.toContain('real-model');
    expect(h).toContain('demo-model');
    expect(h).not.toContain('Лимит и правила');
    expect(await AI.saveAiBudget({}, form({ monthly: 1, maxPages: 5 }))).toEqual({ error: DEMO_OFF_MSG });
    expect(await AI.saveFirmAiLimit({}, form({ firm: ID.demo, limit: 1 }))).toEqual({ error: DEMO_OFF_MSG });
  });

  it('the office profile is never written by the demo admin', async () => {
    const [o] = await pg.select().from(schema.appSettings).where(eq(schema.appSettings.key, 'office'));
    expect(o!.value).toEqual(OFFICE);
    as('DEMOADMIN');
    expect(await isOfficeOwner(await getUser())).toBe(false);
  });
});

describe('the real owner never sees demo data in the same views', () => {
  it('aktivnost, produktivnost, kdogovori, kdfakturi, firmIzv, rokovi, kanc, mojzad, klInbox, aiTrosok', async () => {
    as('REALOWNER');
    useFirm(ID.real!);
    const H: Record<string, string> = {
      aktivnost: await html(Pages.aktivnost(sp({}))),
      produktivnost: await html(Pages.produktivnost(sp({ p: 'month' }))),
      kdogovori: await html(Pages.kdogovori(sp({ f: ID.real }))),
      kdfakturi: await html(Pages.kdfakturi(sp({ m: YM }))),
      firmIzv: await html(Pages.firmIzv(sp({ f: ID.real, y: String(Y) }))),
      rokovi: await html(Pages.rokovi(sp({ v: 'lista', m: YM }))),
      kanc: await html(Pages.kanc(sp({ st: 'all', nov: '' }))),
      mojzad: await html(Pages.mojzad()),
      klInbox: await html(Pages.klInbox(sp({}))),
      aiTrosok: await html(Pages.aiTrosok(sp({}))),
    };
    for (const [k, h] of Object.entries(H)) noDemo(h, k);
    expect(H.aktivnost).toContain('realAction');
    expect(H.kanc).toContain('РЕАЛНА ЗАДАЧА');
    expect(H.klInbox).toContain('РЕАЛНА ПОРАКА');
    expect(H.aiTrosok).toContain('real-model');
    expect(H.aiTrosok).not.toContain('demo-orphan-model');
    expect(H.kdogovori).toContain('БАЈРАМИ ГРОУП');
    // a demo firm through a forged id
    const h = await html(Pages.firmIzv(sp({ f: ID.demo, y: String(Y) })));
    expect(h).toContain('Фирмата не постои');
    const D = await loadProductivity(prodFilter({ p: 'month' }), await getUser());
    expect(D.userList.some((x) => x.name.startsWith('DEMO'))).toBe(false);
    expect(D.firmList.some((x) => x.name.startsWith('ДЕМО'))).toBe(false);
    expect(await KD.saveContract(ID.demo!, JSON.stringify({ date: `${Y}-03-01`, fee: 1 }))).toHaveProperty('error');
    expect(await KC.saveTask({}, form({ title: 'X', firmId: ID.demo }))).toHaveProperty('error');
  });
});
