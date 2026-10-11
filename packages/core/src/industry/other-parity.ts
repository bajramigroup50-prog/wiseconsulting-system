/**
 * Legacy parity of the "other" industry views: construction analyses (legacy `cpRow` / `VIEWS.gradbaIzv` 11821–11838),
 * Excel imports with templates for the master data of gradba / tura / kartoni / periodicni, appointment reminders
 * (WhatsApp link, legacy `apRemOne` 10147), travel passport checks, the per-firm module toggle with the legacy
 * tri-state setting (auto / always on / off, legacy `VIEWS.moduli` 10231 + `modOnF` 10225), the entity-type radio
 * (legacy 10531) and the recurring-invoice bulk / accounting-contract plans (legacy `rbSave` 13526, `kdRecPlan` 13556).
 */
import { addDays, num, r2 } from './common';
import { INDUSTRY_MODULES, nkdProfiles } from './modules';

/* ================================================================== import helpers */

export type OxCell = string | number | null | undefined;

/** One column of an import: the key, accepted header texts (first = template header), required flag. */
export interface OxCol { k: string; h: readonly string[]; req?: boolean }

const normH = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();

/**
 * Map an imported sheet (array of arrays, header row first) to records by header text. Columns are matched by any
 * accepted header (case / punctuation insensitive). Rows that are empty in every mapped column are skipped.
 */
export function oxRows(rows: readonly (readonly OxCell[])[], cols: readonly OxCol[]): { rows: (Record<string, string> & { _row: string })[]; errors: string[] } {
  const errors: string[] = [];
  if (!rows.length) return { rows: [], errors: ['Датотеката е празна.'] };
  const H = (rows[0] ?? []).map(normH);
  const ix: Record<string, number> = {};
  for (const c of cols) {
    const i = H.findIndex((h) => c.h.some((a) => normH(a) === h));
    if (i >= 0) ix[c.k] = i;
    else if (c.req) errors.push(`Недостасува колона „${c.h[0]}“.`);
  }
  if (errors.length) return { rows: [], errors };
  const out: (Record<string, string> & { _row: string })[] = [];
  rows.slice(1).forEach((r, j) => {
    const o: Record<string, string> = {};
    for (const c of cols) o[c.k] = ix[c.k] != null ? String(r[ix[c.k]!] ?? '').trim() : '';
    if (!Object.values(o).some((v) => v)) return;
    const miss = cols.filter((c) => c.req && !o[c.k]);
    if (miss.length) { errors.push(`Ред ${j + 2}: празно „${miss.map((c) => c.h[0]).join(', ')}“.`); return; }
    out.push({ ...o, _row: String(j + 2) });
  });
  return { rows: out, errors };
}

/** Template (header row + sample rows) of an import. */
export const oxTemplate = (cols: readonly OxCol[], samples: readonly (readonly OxCell[])[] = []): OxCell[][] => [cols.map((c) => c.h[0]!), ...samples.map((r) => [...r])];

/** Number from an Excel cell: `1.234,50`, `1,234.50`, `1234,5`, `3000 ден.` → number (0 when empty / invalid). */
export function oxNum(v: OxCell): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').replace(/[^\d,.\-]/g, '');
  if (!s) return 0;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = /,\d{3}$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Date from an Excel cell: `YYYY-MM-DD`, `DD.MM.YYYY`, `M/D/YY` (Excel's US text), Excel serial number → ISO or ''. */
export function oxDate(v: OxCell): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const p2 = (n: number) => String(n).padStart(2, '0');
  const ok = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    const x = new Date(Date.UTC(y, m - 1, d));
    return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? `${y}-${p2(m)}-${p2(d)}` : '';
  };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ok(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?$/);
  if (m) return ok(+m[3]!, +m[2]!, +m[1]!);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return ok(+m[3]!, +m[1]!, +m[2]!);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const x = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5);
    return x.toISOString().slice(0, 10);
  }
  return '';
}

/** Yes / no cell: да, yes, 1, x, true, ✓ → true. */
export const oxBool = (v: OxCell): boolean => /^(да|d|yes|y|1|x|true|✓|вкл)/i.test(String(v ?? '').trim());

/* ================================================================== construction */

export const CONS_PROJECT_IMPORT: readonly OxCol[] = [
  { k: 'code', h: ['Шифра', 'Код'] }, { k: 'name', h: ['Објект / проект', 'Објект', 'Назив', 'Проект'], req: true },
  { k: 'site', h: ['Локација', 'Адреса', 'Локација (адреса, КП)'] }, { k: 'city', h: ['Град / општина', 'Град', 'Општина'] },
  { k: 'investor', h: ['Инвеститор'], req: true }, { k: 'edb', h: ['ЕДБ на инвеститорот', 'ЕДБ'] },
  { k: 'cno', h: ['Договор бр.', 'Договор'] }, { k: 'cdate', h: ['Датум на договор'] }, { k: 'start', h: ['Почеток'] },
  { k: 'end', h: ['Рок за завршување', 'Рок'] }, { k: 'nadzor', h: ['Надзор'] }, { k: 'eng', h: ['Одговорен инженер', 'Инженер'] },
  { k: 'art32', h: ['Чл. 32-а (да/не)', 'Чл. 32-а', 'Пренесување на даночна обврска'] },
];
export const CONS_BOQ_IMPORT: readonly OxCol[] = [
  { k: 'pos', h: ['Поз.', 'Позиција', 'Поз'] }, { k: 'desc', h: ['Опис на работата', 'Опис'], req: true }, { k: 'unit', h: ['ЕМ', 'Ед. мера', 'Единица мерка'] },
  { k: 'qty', h: ['Количина', 'Кол.'] }, { k: 'price', h: ['Ед. цена', 'Цена', 'Единечна цена'] },
];

/** Legacy `cpRow` inputs of one project (amounts in MKD, revenue without VAT, gross / paid with VAT). */
export interface ConsAnalysisInput {
  id: string; name: string; city: string | null; investor: string; status: 'open' | 'done';
  boq: number; exe: number; pct: number; rev: number; gross: number; paid: number; pur: number; blg: number; lab: number; cost: number;
}
export interface ConsAnalysisRow extends ConsAnalysisInput { open: number; res: number; nonInv: number }

/** Legacy `cpRow`: open receivable, result and the executed-but-not-invoiced amount. */
export const consRow = (x: ConsAnalysisInput): ConsAnalysisRow => ({
  ...x, city: x.city || '—', open: r2(x.gross - x.paid), res: r2(x.rev - x.cost), nonInv: r2(Math.max(0, x.exe - x.rev)),
});

/** Legacy `pc(a, b)`: whole percent, '' when b is 0. */
export const pctOf = (a: number, b: number): string => (b ? Math.round((a / b) * 100) + '%' : '');

const SUM_KEYS = ['boq', 'exe', 'rev', 'gross', 'paid', 'open', 'nonInv', 'pur', 'blg', 'lab', 'cost', 'res'] as const;
export type ConsSum = Record<(typeof SUM_KEYS)[number], number>;
export const consSum = (A: readonly ConsAnalysisRow[]): ConsSum =>
  Object.fromEntries(SUM_KEYS.map((k) => [k, r2(A.reduce((s, x) => s + num(x[k]), 0))])) as ConsSum;

/** Legacy status filter `ga_st` ('' all, 'open' in progress, 'done' finished). */
export const consFilter = <T extends { status: string }>(L: readonly T[], st: string): T[] =>
  L.filter((x) => !st || (st === 'done' ? x.status === 'done' : x.status !== 'done'));

/** Legacy "📍 По објект и град": projects grouped by city (sorted), with totals per city. */
export function consByCity(L: readonly ConsAnalysisRow[]): { city: string; rows: ConsAnalysisRow[]; tot: ConsSum }[] {
  const cities = [...new Set(L.map((x) => x.city || '—'))].sort((a, b) => a.localeCompare(b, 'mk'));
  return cities.map((city) => { const rows = L.filter((x) => (x.city || '—') === city); return { city, rows, tot: consSum(rows) }; });
}

/** Legacy "📅 По месец": situations (executed this situation, invoiced base) and costs by month of the year. */
export function consByMonth(sits: readonly { date: string; cur: number; inv: number }[], costs: readonly { d: string; amt: number }[], year: number | string) {
  const by: Record<string, { exe: number; inv: number; cost: number; n: number }> = {};
  const get = (mo: string) => (by[mo] ??= { exe: 0, inv: 0, cost: 0, n: 0 });
  for (const s of sits) { const o = get(String(s.date).slice(0, 7)); o.exe += num(s.cur); o.inv += num(s.inv); o.n++; }
  for (const c of costs) get(String(c.d).slice(0, 7)).cost += num(c.amt);
  return Object.entries(by).filter(([k]) => k.startsWith(String(year))).sort(([a], [b]) => a.localeCompare(b))
    .map(([mo, o]) => ({ mo, n: o.n, exe: r2(o.exe), inv: r2(o.inv), cost: r2(o.cost), diff: r2(o.exe - o.cost) }));
}

/* ================================================================== travel */

export const TRAVEL_ARR_IMPORT: readonly OxCol[] = [
  { k: 'code', h: ['Шифра'] }, { k: 'name', h: ['Назив на аранжманот', 'Назив', 'Аранжман'], req: true }, { k: 'dest', h: ['Дестинација'] },
  { k: 'from', h: ['Поаѓање'] }, { k: 'to', h: ['Враќање'] }, { k: 'kind', h: ['Вид (сопствен / посредување)', 'Вид'] },
  { k: 'seats', h: ['Места'] }, { k: 'price', h: ['Цена по возрасен (со ДДВ)', 'Цена по возрасен', 'Цена'] }, { k: 'priceCh', h: ['Цена по дете'] },
  { k: 'comm', h: ['Провизија %', 'Провизија'] }, { k: 'status', h: ['Статус'] }, { k: 'prog', h: ['Програма на патувањето', 'Програма'] },
  { k: 'incl', h: ['Цената вклучува'] }, { k: 'excl', h: ['Цената не вклучува'] },
];

/** Arrangement kind from an import cell (посредување / agent → agent, else own). */
export const importArrKind = (v: OxCell): 'own' | 'agent' => (/посред|агент|agent|провиз/i.test(String(v ?? '')) ? 'agent' : 'own');
/** Arrangement status from an import cell (text of `ARRANGEMENT_STATUS` or the key). */
export function importArrStatus(v: OxCell): 'open' | 'full' | 'done' | 'cancel' {
  const s = String(v ?? '').toLowerCase();
  if (/full|пополн/.test(s)) return 'full';
  if (/done|реализ/.test(s)) return 'done';
  if (/cancel|откаж/.test(s)) return 'cancel';
  return 'open';
}

/** Legacy passport rule (11895 / 11982): no document, or valid less than 3 months after the return. */
export const passportWarn = (p: { name?: string | null; doc?: string | null; docExp?: string | null }, A: { from?: string | null; to?: string | null }, today: string): boolean =>
  !!p.name && (!p.doc || (!!p.docExp && p.docExp < addDays(A.to || A.from || today, 90)));

/** Legacy `tbSave` seat check (11939): total passengers with this booking vs the arrangement's seats. */
export const seatsExceeded = (seats: number | string | null | undefined, usedOthers: number, thisPax: number): number | null =>
  num(seats) && usedOthers + thisPax > num(seats) ? usedOthers + thisPax : null;

/* ================================================================== appointments / client cards */

/** Legacy `apRemOne`: phone for wa.me (digits, leading 0 → 389). */
export const apptWaPhone = (phone: string | null | undefined): string => String(phone ?? '').replace(/\D/g, '').replace(/^0/, '389');
/** Legacy WhatsApp reminder link `https://wa.me/<phone>?text=` ('' without a phone). */
export const apptWaLink = (phone: string | null | undefined, text: string): string => {
  const p = apptWaPhone(phone);
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(text)}` : '';
};

/** Legacy `apRemAll` targets: tomorrow's booked appointments without a reminder. */
export const apptRemindTargets = <T extends { date: string; status: string; remindAt?: unknown }>(L: readonly T[], tomorrow: string): T[] =>
  L.filter((a) => a.date === tomorrow && a.status === 'booked' && !a.remindAt);

export const CLIENT_IMPORT: readonly OxCol[] = [
  { k: 'name', h: ['Име и презиме / назив', 'Име и презиме', 'Име', 'Назив', 'Клиент', 'Пациент'], req: true },
  { k: 'phone', h: ['Телефон', 'Тел.'] }, { k: 'email', h: ['Е-пошта', 'Email', 'E-mail'] }, { k: 'address', h: ['Адреса'] },
  { k: 'city', h: ['Град'] }, { k: 'edb', h: ['ЕДБ', 'ЕМБГ / ЕДБ'] }, { k: 'birth', h: ['Датум на раѓање', 'Роден/а'] }, { k: 'note', h: ['Белешка', 'Забелешка'] },
];

/* ================================================================== recurring invoices */

export const REC_IMPORT: readonly OxCol[] = [
  { k: 'partner', h: ['Комитент', 'Купувач'], req: true }, { k: 'edb', h: ['ЕДБ'] },
  { k: 'every', h: ['Се повторува', 'Повторување', 'Период'] }, { k: 'day', h: ['Ден во месецот (1–28 или L)', 'Ден во месецот', 'Ден'] },
  { k: 'next', h: ['Следна фактура на', 'Следна'] }, { k: 'end', h: ['Заклучно со', 'Крај'] }, { k: 'dueDays', h: ['Рок на плаќање (дена)', 'Рок'] },
  { k: 'note', h: ['Опис на фактурата', 'Опис'] }, { k: 'item', h: ['Ставка', 'Услуга'], req: true }, { k: 'qty', h: ['Количина', 'Кол.'] },
  { k: 'price', h: ['Цена без ДДВ', 'Цена'], req: true }, { k: 'vat', h: ['ДДВ %', 'ДДВ'] }, { k: 'mail', h: ['Е-пошта (да/не)', 'Прати по е-пошта'] },
];

/** `every` from an import cell (месечно / тримесечно / полугодишно / годишно). */
export function importEvery(v: OxCell): 'month' | 'quarter' | 'half' | 'year' {
  const s = String(v ?? '').toLowerCase();
  if (/quarter|трим|квартал/.test(s)) return 'quarter';
  if (/half|полугод/.test(s)) return 'half';
  if (/year|годиш/.test(s)) return 'year';
  return 'month';
}
/** Day from an import cell: 1–31, or `L` for "последен работен ден". */
export function importRecDay(v: OxCell): string {
  const s = String(v ?? '').trim();
  if (/^l$|послед/i.test(s)) return 'L';
  return String(Math.min(31, Math.max(1, Math.round(oxNum(s)) || 1)));
}
/** VAT rate from an import cell, limited to the Macedonian rates (default 18). */
export const importVat = (v: OxCell): number => {
  const s = String(v ?? '').trim();
  if (!s) return 18;
  const n = Math.round(oxNum(s));
  return [18, 10, 5, 0].includes(n) ? n : 18;
};

/** Legacy `rbSave` validation: the chosen partners and the ones without a price (own or common). */
export function recBulkPlan(sel: readonly string[], common: number, own: Readonly<Record<string, number | string | undefined>>) {
  const rows = sel.map((id) => ({ id, price: r2(num(own[id]) || num(common)) }));
  return { rows: rows.filter((x) => x.price > 0), missing: rows.filter((x) => !(x.price > 0)).map((x) => x.id) };
}

/**
 * Legacy `kdRecPlan` (13556 → 13590): each client firm with a monthly accounting fee becomes a recurring invoice in
 * the office firm. Status: `нова` (no definition), `нова цена` (price differs), `крај` (end date changed), `ок`.
 */
export function accFeeStatus(fee: number, end: string | null | undefined, ex: { price: number; end?: string | null } | null): 'нова' | 'нова цена' | 'крај' | 'ок' {
  if (!ex) return 'нова';
  if (Math.abs(num(ex.price) - fee) > 0.009) return 'нова цена';
  if (end && (ex.end ?? '') !== end) return 'крај';
  return 'ок';
}

/* ================================================================== modules */

/** Legacy tri-state module setting: '' = automatic (by activity), '1' = always on, '0' = off. */
export type ModSetting = '' | '1' | '0';

/** Legacy `firmProf`: the manual profile list when set, else the profiles of the NKD code. */
export const firmProfiles = (activity: string | null | undefined, kl: { prof?: readonly string[] | null; profSet?: boolean } | null | undefined): string[] =>
  Array.isArray(kl?.prof) && (kl!.profSet || kl!.prof!.length) ? [...kl!.prof!] : nkdProfiles(activity);
export const profilesAuto = (kl: { prof?: readonly string[] | null; profSet?: boolean } | null | undefined): boolean =>
  !(Array.isArray(kl?.prof) && (kl!.profSet || kl!.prof!.length));

/** Legacy `modOnF`: an explicit setting wins, otherwise the module is on when it suits one of the profiles. */
export const moduleOnFor = (k: string, profiles: readonly string[], ov: Readonly<Record<string, boolean>>): boolean => {
  const m = INDUSTRY_MODULES.find((x) => x.k === k);
  if (!m) return true;
  if (ov[k] != null) return !!ov[k];
  return m.p.some((p) => profiles.includes(p));
};

/** The enabled module list (`firms.mods`) for profiles + explicit settings. */
export const effectiveModules = (profiles: readonly string[], ov: Readonly<Record<string, boolean>>): string[] =>
  INDUSTRY_MODULES.filter((m) => moduleOnFor(m.k, profiles, ov)).map((m) => m.k);

/**
 * Explicit settings of a firm: the stored map, or — for firms saved before the tri-state existed — derived from the
 * enabled list so that nothing changes (on but not suggested → '1', suggested but off → '0').
 */
export function moduleOverrides(mods: readonly string[], profiles: readonly string[], stored: Readonly<Record<string, boolean>> | null | undefined): Record<string, boolean> {
  if (stored) return { ...stored };
  const o: Record<string, boolean> = {};
  for (const m of INDUSTRY_MODULES) {
    const on = mods.includes(m.k), auto = m.p.some((p) => profiles.includes(p));
    if (on !== auto) o[m.k] = on;
  }
  return o;
}

/** Apply one tri-state setting to the overrides. */
export function setModule(ov: Readonly<Record<string, boolean>>, k: string, v: ModSetting): Record<string, boolean> {
  const o = { ...ov };
  if (v === '') delete o[k];
  else o[k] = v === '1';
  return o;
}

/* ================================================================== entity type (legacy 10531) */

export type EntityKind = 'co' | 'tp' | 'sd' | 'npo';
const LF_ENT: Readonly<Record<string, EntityKind>> = {
  dooel: 'co', doo: 'co', ad: 'co', jtd: 'co', tp: 'tp', adv: 'sd', not: 'sd', izv: 'sd', zan: 'sd', lek: 'sd', arh: 'sd', sd: 'sd', zdr: 'npo', fon: 'npo', soj: 'npo',
};
/** Legacy radio handler: keep the current legal form when it already means the chosen entity, else the default one. */
export const legalFormForEntity = (cur: string | null | undefined, ent: EntityKind): string =>
  cur && LF_ENT[cur] === ent ? cur : ({ co: 'dooel', tp: 'tp', sd: 'sd', npo: 'zdr' } as const)[ent];
