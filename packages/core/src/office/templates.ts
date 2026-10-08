/**
 * Word templates — legacy `tplNorm` / `tplKinds` / `TPL_COMMON` / `tplVars` (16001–16035).
 * Placeholders in the .docx are `{{KEY}}` (legacy `tplScan` regex); keys are normalised upper-case with `_`.
 */
import { dmy } from './dates';

export const tplNorm = (k: string) => String(k ?? '').trim().toUpperCase().replace(/\s+/g, '_');

export const TPL_COMMON = [
  'ДАТУМ', 'ГОДИНА', 'ФИРМА', 'ФИРМА_ЕДБ', 'ФИРМА_ЕМБС', 'ФИРМА_АДРЕСА', 'ФИРМА_ГРАД', 'ФИРМА_УПРАВИТЕЛ', 'ФИРМА_ДЕЈНОСТ',
  'ФИРМА_СМЕТКА', 'ФИРМА_БАНКА', 'ФИРМА_ЕМАИЛ', 'КАНЦЕЛАРИЈА', 'КАНЦЕЛАРИЈА_ЕДБ', 'КАНЦЕЛАРИЈА_АДРЕСА', 'КАНЦЕЛАРИЈА_ГРАД',
  'КАНЦЕЛАРИЈА_УПРАВИТЕЛ',
] as const;

export interface TplKind { key: string; name: string; grp: string; vars: string[] }

const OSN = ['ОСНОВАЧ', 'ОСНОВАЧ_ПОДАТОЦИ', 'ОСНОВАЧ_ЕМБГ', 'ОСНОВАЧ_АДРЕСА', 'ОСНОВАЧ_ДРЖАВЈАНСТВО', 'УПРАВИТЕЛ', 'УПРАВИТЕЛ_ПОДАТОЦИ', 'УПРАВИТЕЛ_ЕМБГ', 'УПРАВИТЕЛ_АДРЕСА', 'НАЗИВ', 'НАЗИВ_ЦЕЛОСЕН', 'НАЗИВ_СКРАТЕН', 'ФОРМА', 'СЕДИШТЕ', 'ГРАД', 'ДАТУМ_ИЗЈАВА', 'ДЕЈНОСТ', 'ГЛАВНИНА', 'ГЛАВНИНА_ИЗНОС', 'ПОЛНОМОШНИК', 'ПОЛНОМОШНИК_ЕМБГ', 'ПОЛНОМОШНИК_ГРАД'];
const CT = ['РАБОТНИК', 'РАБОТНИК_ЕМБГ', 'РАБОТНИК_АДРЕСА', 'ДОГОВОР_БРОЈ', 'ДАТУМ_ПОТПИС', 'РАБОТНО_МЕСТО', 'ВИД_ДОГОВОР', 'ПОЧЕТОК', 'КРАЈ', 'ПРОБНА_РАБОТА', 'МЕСТО_РАБОТА', 'ДОЛЖНОСТИ', 'ПРЕТСТАВНИК', 'ПРЕТСТАВНИК_ФУНКЦИЈА', 'ПРИЧИНА_ОПРЕДЕЛЕНО'];
const DI = ['РАБОТНИК', 'РАБОТНИК_ЕМБГ', 'РАБОТНИК_АДРЕСА', 'РАБОТНО_МЕСТО', 'БРОЈ', 'ДАТУМ_ДОКУМЕНТ', 'ОПИС', 'ПРЕТСТАВНИК', 'ПРЕТСТАВНИК_ФУНКЦИЈА'];
const AML = ['ВИСТИНСКИ_СОПСТВЕНИЦИ', 'ЗАСТАПНИК', 'ЗАСТАПНИК_ЕМБГ', 'ЦЕЛ_НА_ОДНОСОТ', 'ИЗВОР_НА_СРЕДСТВА', 'РИЗИК', 'СЛЕДНА_АНАЛИЗА'];

/** Document kinds a template can be attached to (legacy `tplKinds`, minus the per-position contract list of Phase 6). */
export function tplKinds(): TplKind[] {
  const L: TplKind[] = [];
  const add = (key: string, name: string, grp: string, vars: string[]) => L.push({ key, name, grp, vars });
  add('free', 'Слободен документ (само општи податоци)', 'Општо', []);
  for (const t of ['Изјава за основање', 'Изјава по член 29 и 32 од ЗТД', 'Изјава по член 32 и 183 од ЗТД (управител)', 'Полномошно', 'Изјава (личен потпис)']) add(`d:${t}`, t, 'Основање на фирма', OSN);
  add('ct', 'Договор за вработување (општ)', 'Вработени', CT);
  for (const t of ['Писмено предупредување', 'Решение за дисциплинска мерка', 'Решение за отказ на договор за вработување', 'Спогодба за раскинување на договор за вработување', 'Потврда за прием на отказ од работникот', 'Известување за престанок поради истек на времето']) add(`d:${t}`, t, 'Вработени – мерки и престанок', DI);
  add('kd', 'Договор за сметководствени услуги', 'Клиенти', ['ДОГОВОР_БРОЈ', 'ДАТУМ_ДОГОВОР', 'МЕСТО_ДОГОВОР', 'НАДОМЕСТ', 'УСЛУГИ', 'ПРЕТСТАВНИК', 'ПРЕТСТАВНИК_ФУНКЦИЈА', 'НАПОМЕНА']);
  add('d:Договор за обработка на лични податоци', 'Договор за обработка на лични податоци (ЗЗЛП)', 'Клиенти', []);
  add('d:Изјава за доверливост', 'Изјава за доверливост', 'Вработени', ['ЛИЦЕ', 'ЛИЦЕ_ЕМБГ', 'ЛИЦЕ_ФУНКЦИЈА']);
  add('d:Барање за мислење до УЈП', 'Барање за мислење до УЈП', 'Канцеларија', []);
  for (const t of ['Анализа на клиент (ПП/ФТ)', 'Изјава за вистински сопственик и носител на јавна функција']) add(`d:${t}`, t, 'УФР (перење пари)', AML);
  for (const t of ['Програма за спречување ПП/ФТ', 'Одлука за овластено лице', 'Проценка на ризик на канцеларијата']) add(`d:${t}`, t, 'УФР (перење пари)', ['ОВЛАСТЕНО_ЛИЦЕ', 'ЗАМЕНИК']);
  return L;
}

export interface TplFirm {
  name?: string | null; edb?: string | null; embs?: string | null; address?: string | null; city?: string | null;
  email?: string | null; activity?: string | null; nkd?: string | null; manager?: string | null; bankAccount?: string | null; bankName?: string | null;
}
export interface TplOffice { name?: string; edb?: string; address?: string; city?: string; rep?: string }

/** Legacy `tplVars` (common part): firm + office values; empty values are left out so they show as missing. */
export function tplVars(f: TplFirm, O: TplOffice, today: string, extra: Record<string, string | number | null | undefined> = {}): Record<string, string> {
  const V: Record<string, string> = {};
  const set = (k: string, v: unknown) => { if (v != null && v !== '') V[tplNorm(k)] = String(v); };
  set('ДАТУМ', dmy(today)); set('ГОДИНА', today.slice(0, 4));
  set('ФИРМА', f.name); set('ФИРМА_ЕДБ', f.edb); set('ФИРМА_ЕМБС', f.embs); set('ФИРМА_АДРЕСА', f.address); set('ФИРМА_ГРАД', f.city);
  set('ФИРМА_УПРАВИТЕЛ', f.manager);
  const nk = String(f.nkd ?? '').trim(), ac = String(f.activity ?? '').trim();
  set('ФИРМА_ДЕЈНОСТ', ac && nk && ac.replace(/\s/g, '').startsWith(nk.replace(/\s/g, '')) ? ac : [nk, ac].filter(Boolean).join(' – '));
  set('ФИРМА_СМЕТКА', f.bankAccount); set('ФИРМА_БАНКА', f.bankName); set('ФИРМА_ЕМАИЛ', f.email);
  set('КАНЦЕЛАРИЈА', O.name); set('КАНЦЕЛАРИЈА_ЕДБ', O.edb); set('КАНЦЕЛАРИЈА_АДРЕСА', O.address); set('КАНЦЕЛАРИЈА_ГРАД', O.city);
  set('КАНЦЕЛАРИЈА_УПРАВИТЕЛ', O.rep);
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return V;
}

/** Placeholders found in a text (legacy `tplScan` regex, applied per paragraph). */
export function tplScanText(text: string): string[] {
  const S = new Set<string>();
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) S.add(tplNorm(m[1]!));
  return [...S];
}

/** Value used for a placeholder with no data (legacy leaves a blank line to fill in by hand). */
export const TPL_MISSING = '________';
