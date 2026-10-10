/**
 * „📥 Плата од Excel“ (legacy v478 `PXL_COLS` / `plxTpl` / `plxImp`, 14736–14781): a template with the firm's
 * employees → filled in by the client → imported as a draft month (nothing is booked until „Пресметка (F4)“).
 *
 * DELIBERATE FIX: legacy `plxTpl` wrote 17 values per row into a 28-column header (net in „Презиме“, coef in
 * „Нето плата“ …). The template rows are built by column key here, so the file reads back correctly.
 */
import { empCalc, fixRegular, payCatOf, stazFor, type PayEmp, type PayLine } from './calc';
import { MPIN_OPS, mpinEmpCodes } from './mpin';
import type { PayParams } from './params';
import { impDate, impN, impNum } from '../retail/import';

export type PxlKey =
  | 'embg' | 'name' | 'sur' | 'pos' | 'oe' | 'net' | 'gross' | 'coef' | 'staz' | 'start' | 'regPlan' | 'reg' | 'hol' | 'odm' | 'bol' | 'bol30'
  | 'ot' | 'sun' | 'night' | 'holw' | 'paid' | 'bonus' | 'otPay' | 'sunPay' | 'holPay' | 'total' | 'ops' | 'fzo';

/** [key, header label, aliases] — legacy `PXL_COLS` verbatim. */
export const PXL_COLS: readonly (readonly [PxlKey, string, string])[] = [
  ['embg', 'ЕМБГ', 'ембг,embg,matični,nr personal,личен број,tc kimlik,kimlik'],
  ['name', 'Име и презиме', 'име,презиме,name,emri,вработен,punetori,isim,ad soyad,adı'],
  ['sur', 'Презиме (ако е посебна колона)', 'soyisim,soyad,soyadı,mbiemri'],
  ['pos', 'Работно место', 'görev,gorev,pozita,работно место,position'],
  ['oe', 'Подружница / единица (за испраќање по единици)', 'подружница,podruznica,podružnica,организациона единица,единица,пункт,şube,sube,birim,departman,bölüm,bolum,njesia,njësia,objekti,lokacioni,lokacija'],
  ['net', 'Нето плата', 'нето,net,neto,paga neto,maaş,maas,rroga'],
  ['gross', 'Бруто плата (ако нема нето)', 'бруто,gross,bruto'],
  ['coef', 'Коефициент', 'коеф,coef,koef'],
  ['staz', 'Вкупен стаж (години) – минат труд', 'стаж,staz,stazh,kidem,kıdem,minat trud,минат труд,pervoja'],
  ['start', 'Датум на вработување', 'вработување,işe giriş,ise giris,giriş tarihi,data e punesimit,start'],
  ['regPlan', 'Месечен фонд (ч или дена)', 'resmi mesai,fond'],
  ['reg', 'Редовни часови', 'çalıştığı resmi mesai,calistigi resmi mesai,редовн,regular,orë të rregullta,часови редовно'],
  ['hol', 'Државен празник (ч)', 'празник ч,државен,festa'],
  ['odm', 'Годишен одмор (ч)', 'одмор,pushim,leave'],
  ['bol', 'Боледување до 30 дена (ч)', 'боледување до,bolovanje do,sëmundje deri'],
  ['bol30', 'Боледување над 30 дена (ч)', 'над 30,над30,mbi 30'],
  ['ot', 'Прекувремена (ч)', 'ekstra mesai,прекувремен,overtime,jashtë orarit'],
  ['sun', 'Работа во недела (ч)', 'pazar çalışma,pazar calisma,недела,e diel'],
  ['night', 'Ноќна работа (ч)', 'ноќ,night,natë'],
  ['holw', 'Работа на празник (ч)', 'tatil çalışma,tatil calisma,работа на празник,punë në festë'],
  ['paid', 'Платено отсуство (ч)', 'платено отсуство,paid leave'],
  ['bonus', 'Бонус / награда (ден.)', 'prim ödemesi,prim odemesi,prim,бонус,награда,bonus,shpërblim'],
  ['otPay', 'Износ прекувремена (контрола)', 'mesai ödemesi,mesai odemesi'],
  ['sunPay', 'Износ недела (контрола)', 'pazar ödemesi,pazar odemesi'],
  ['holPay', 'Износ празник (контрола)', 'tatil ödemesi,tatil odemesi'],
  ['total', 'Вкупно за исплата (контрола)', 'toplam ödeme,toplam odeme,вкупно,total,gjithsej'],
  ['ops', 'Општина МПИН 3.4ц', 'општина,opstina,komuna'],
  ['fzo', 'ФЗО МПИН 3.4б', 'фзо,подрачна,fzo'],
];

/** Hour columns → payroll line [type, %] (legacy `PXL_LINE`). */
export const PXL_LINE: Readonly<Partial<Record<PxlKey, readonly [string, number]>>> = {
  hol: ['Државен празник', 100],
  odm: ['Годишен одмор', 100],
  bol: ['Боледување до 30 дена', 70],
  bol30: ['Боледување над 30 дена (рефундација ФЗО)', 70],
  ot: ['Прекувремена работа', 150],
  night: ['Работа ноќе', 135],
  holw: ['Работа на празник / неработен ден', 150],
  sun: ['Работа во недела', 150],
  paid: ['Платено отсуство (брак, смрт, селидба…)', 100],
};

export const PXL_HELP: readonly string[] = [
  'Упатство',
  '1. Еден ред = еден вработен. ЕМБГ (13 цифри) е задолжителен – по него се поврзува со „Вработени“; ако го нема, вработениот се додава.',
  '2. Нето ИЛИ бруто плата (за полно работно време). Коефициент 0,5 = половина работно време.',
  '3. Часови: ако „Редовни часови“ е празно, се пресметува од календарот минус одмор/боледување/отсуство.',
  '4. Општина (3.4ц, пр. 183) и ФЗО (3.4б, пр. 4061) – ако се празни, се земаат од градот на вработениот.',
  '5. По увозот програмата го отвора месецот како предлог – проверете и притиснете „Пресметка (F4)“.',
];

/** Legacy `plxN`: Turkish İ/ı → i, lower-case, strip diacritics, then `impN`. */
export const plxN = (x: unknown): string =>
  impN(String(x ?? '').replace(/[İI]/g, 'i').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i'));

export interface PxlTemplateEmployee {
  no?: string | null; name: string; embg?: string | null; position?: string | null; oe?: string | null;
  netBase?: number | string | null; coef?: number | string | null; start?: string | null;
  city?: string | null; address?: string | null; mpOps?: string | null; mpZan?: string | null; active?: boolean;
}

/** File name `Plata_{mo}_{firm}.xlsx` (legacy `plxTpl`). */
export const plxFileName = (month: string, firmName: string): string =>
  'Plata_' + month + '_' + String(firmName || '').replace(/[^\wА-Шѓќљњџѕјa-z]+/gi, '_').slice(0, 30) + '.xlsx';

/** Template sheets: `Плата {mo}` (header + one row per active employee, sorted by number) and `Упатство`. */
export function plxTemplate(month: string, employees: readonly PxlTemplateEmployee[], M: { work: number; hol: number }): { name: string; rows: (string | number)[][] }[] {
  const E = employees.filter((e) => e.active !== false).slice().sort((a, b) => String(a.no || '').localeCompare(String(b.no || ''), 'mk', { numeric: true }));
  const row = (o: Partial<Record<PxlKey, string | number>>) => PXL_COLS.map(([k]) => o[k] ?? '');
  const rows: (string | number)[][] = [PXL_COLS.map((c) => c[1])];
  for (const e of E) {
    const c = mpinEmpCodes({ city: e.city ?? '', address: e.address ?? '', mpOps: e.mpOps ?? '', mpZan: e.mpZan ?? '' });
    rows.push(row({
      embg: e.embg || '', name: e.name || '', pos: e.position || '', oe: e.oe || '', net: +(e.netBase ?? 0) || '', coef: +(e.coef ?? 0) || 1,
      regPlan: M.work, hol: M.hol || '', ops: c.ops || '', fzo: c.fzo || '',
    }));
  }
  if (!E.length) rows.push(row({ embg: '0101990450000', name: 'Име Презиме', net: 30000, coef: 1, regPlan: M.work, hol: M.hol || '' }));
  return [{ name: 'Плата ' + month, rows }, { name: 'Упатство', rows: PXL_HELP.map((t) => [t]) }];
}

export interface PxlRecord {
  embg: string; name: string; pos: string; oe: string; ops: string; fzo: string; start: string;
  net: number | null; gross: number | null; coef: number | null; staz: number | null;
  reg: number | null; regPlan: number | null; bonus: number | null; total: number | null;
  hours: Partial<Record<PxlKey, number | null>>;
}

/** Find the header row (≥ 3 recognised columns), map the columns and read the employee rows. */
export function plxParse(aoa: readonly (readonly unknown[])[]): { error: string } | { map: Partial<Record<PxlKey, number>>; rows: PxlRecord[] } {
  const isCol = (x: unknown) => PXL_COLS.some((c) => c[2].split(',').some((a) => plxN(a).length > 2 && plxN(x).includes(plxN(a))));
  const hi = aoa.findIndex((r) => r.filter(isCol).length >= 3);
  if (hi < 0) return { error: 'Не се препознаени колоните. Користете го „Excel образец“.' };
  const H = aoa[hi]!.map((x) => plxN(x));
  const map: Partial<Record<PxlKey, number>> = {};
  const used = new Set<number>();
  for (const [k, lab, al] of PXL_COLS) {
    const A = [plxN(lab), ...al.split(',').map(impN)];
    let i = H.findIndex((x, j) => !used.has(j) && A.includes(x));
    if (i < 0) i = H.findIndex((x, j) => !used.has(j) && A.some((a) => a.length > 2 && x.includes(a)));
    if (i >= 0) { map[k] = i; used.add(i); }
  }
  if (map.name == null && map.embg == null) return { error: 'Нема колона ЕМБГ или Име.' };
  const g = (r: readonly unknown[], k: PxlKey): unknown => (map[k] == null ? '' : r[map[k]!]);
  const num = (v: unknown): number | null => (v === '' || v == null || String(v).trim() === '' ? null : impNum(v));
  const str = (v: unknown) => String(v ?? '').trim();
  const rows: PxlRecord[] = [];
  for (const r of aoa.slice(hi + 1)) {
    if (!str(g(r, 'name') || g(r, 'embg'))) continue;
    if (/^(toplam|вкупно|total|gjithsej)/i.test(str(g(r, 'name')))) continue;
    let embg = str(g(r, 'embg')).replace(/\D/g, '');
    if (embg && embg.length < 13) embg = embg.padStart(13, '0');
    const hours: PxlRecord['hours'] = {};
    for (const k of Object.keys(PXL_LINE) as PxlKey[]) hours[k] = num(g(r, k));
    rows.push({
      embg, name: [str(g(r, 'name')), str(g(r, 'sur'))].filter(Boolean).join(' '), pos: str(g(r, 'pos')), oe: str(g(r, 'oe')),
      ops: str(g(r, 'ops')).replace(/\D/g, ''), fzo: str(g(r, 'fzo')).replace(/\D/g, ''), start: g(r, 'start') ? impDate(/^\d{5}$/.test(str(g(r, 'start'))) ? +str(g(r, 'start')) : g(r, 'start')) : '',
      net: num(g(r, 'net')), gross: num(g(r, 'gross')), coef: num(g(r, 'coef')), staz: num(g(r, 'staz')),
      reg: num(g(r, 'reg')), regPlan: num(g(r, 'regPlan')), bonus: num(g(r, 'bonus')), total: num(g(r, 'total')), hours,
    });
  }
  return { map, rows };
}

export interface PxlEmployee { id: string; no?: string | null; name: string; embg?: string | null; netBase?: number | string | null; coef?: number | string | null; start?: string | null; stazPrev?: number | string | null; stazY?: number | string | null; hNorm?: number | string | null }

/** Match by ЕМБГ (digits), else by name (case-insensitive) — legacy order. */
export function plxMatch<T extends { embg?: string | null; name: string }>(rec: Pick<PxlRecord, 'embg' | 'name'>, employees: readonly T[]): T | undefined {
  return employees.find((e) => rec.embg && String(e.embg || '').replace(/\D/g, '') === rec.embg)
    ?? employees.find((e) => rec.name && String(e.name || '').toLowerCase() === rec.name.toLowerCase());
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt0 = (v: number) => Math.round(v).toLocaleString('de-DE');

/**
 * One run employee from an imported row (legacy `plxImp` loop body after the employee is found/created).
 * Returns the run employee, the warnings and the part-time fund to save on the card (`hNormSave`).
 */
export function plxEmp(rec: PxlRecord, E: PxlEmployee, month: string, P: PayParams, M: { work: number; hol: number }): { e: PayEmp; warn: string[]; hNormSave: number | null } {
  const warn: string[] = [];
  if (rec.embg && rec.embg.length !== 13) warn.push((rec.name || rec.embg) + ': ЕМБГ не е 13 цифри');
  if (rec.ops && !MPIN_OPS.some((c) => c.code === rec.ops)) warn.push(rec.name + ': општина ' + rec.ops + ' не е во листата 3.4ц');
  const start = E.start || rec.start || '';
  const e: PayEmp = {
    empId: E.id, no: E.no || '', name: E.name, embg: E.embg || rec.embg,
    netBase: rec.net != null ? rec.net : +(E.netBase ?? 0) || 0, coef: rec.coef || +(E.coef ?? 0) || 1,
    stazY: rec.staz != null ? rec.staz : stazFor({ start: start || undefined, stazY: E.stazY ?? undefined, stazPrev: E.stazPrev ?? undefined }, month), lines: [],
  };
  if (rec.staz == null && !start && !+(E.stazPrev ?? 0) && !+(E.stazY ?? 0)) warn.push(E.name + ': нема датум на вработување ни стаж – минат труд = 0 (дополнете во Вработени или колона „Стаж“)');
  if (rec.gross && rec.net == null) e.grossBase = rec.gross;
  let regH = rec.reg;
  if (regH != null && regH > 0 && regH <= 31) regH = regH * 8;
  const fullH = +P.hours || 176;
  let plan = rec.regPlan;
  if (plan != null && plan > 0 && plan <= 31) plan = plan * 8;
  let hNormSave: number | null = null;
  if (plan && plan < fullH - 0.5) e.hNorm = plan;
  else if (+(E.hNorm ?? 0) && +(E.hNorm ?? 0) < fullH) e.hNorm = +(E.hNorm ?? 0);
  if (e.hNorm && !+(E.hNorm ?? 0)) hNormSave = +e.hNorm;
  const fund = +(e.hNorm ?? 0) || fullH;
  const holH = M.hol ? Math.round((M.hol * fund) / fullH) : 0;
  const L: PayLine[] = [{ type: 'Редовно работење', hours: regH != null ? regH : M.work, pct: 100, cat: 'reg' }];
  for (const [k, [t, p]] of Object.entries(PXL_LINE) as [PxlKey, readonly [string, number]][]) {
    const v = rec.hours[k];
    if (k === 'hol' && v == null && holH) {
      if (regH == null || regH + holH <= fund) L.push({ type: t, hours: holH, pct: p, cat: payCatOf(t) });
      continue;
    }
    if (v) L.push({ type: t, hours: v, pct: p, cat: payCatOf(t) });
  }
  if (rec.bonus) L.push({ type: 'Награда / бонус', amt: rec.bonus, cat: 'kor' });
  e.lines = L;
  if (regH == null) fixRegular(e, +(e.hNorm ?? 0) || +P.hours);
  if (!+(e.netBase ?? 0) && !e.grossBase) warn.push(e.name + ': нема нето/бруто плата');
  const coef = +(e.coef ?? 1) || 1;
  if (+(e.netBase ?? 0) && +P.minNet && +(e.netBase ?? 0) * coef < +P.minNet - 1 && coef >= 1) warn.push(e.name + ': нето ' + fmt0(+(e.netBase ?? 0)) + ' е под минималната (' + fmt0(+P.minNet) + ')');
  if (rec.total) {
    try {
      const net = empCalc(e, P).T.net;
      if (Math.abs(net - rec.total) > Math.max(50, rec.total * 0.01)) warn.push(e.name + ': во Excel вкупно ' + fmt0(rec.total) + ', програмата пресмета нето ' + fmt0(net) + ' (разлика ' + fmt0(r2(net - rec.total)) + ')');
    } catch { /* incomplete params: the editor will show it */ }
  }
  return { e, warn, hNormSave };
}
