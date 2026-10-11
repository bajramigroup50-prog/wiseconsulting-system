/** Company formation — legacy `NC_ST` / `NC_CHECK` / `NF` (4001–4003) and capital helpers (14985+). */
import { r2 } from '../money';

export const NC_STATUS = ['prep', 'docs', 'signed', 'esign', 'submitted', 'registered', 'created'] as const;
export type NcStatus = (typeof NC_STATUS)[number];
export const NC_ST: Record<NcStatus, readonly [string, string]> = {
  prep: ['Подготовка', 'info'],
  docs: ['Документи собрани', 'warn'],
  signed: ['Потпишано од клиентот', 'warn'],
  esign: ['Дигитално потпишано', 'warn'],
  submitted: ['Поднесено во ЦРСМ', 'warn'],
  registered: ['Регистрирана', 'good'],
  created: ['Внесена во програмата', 'good'],
};
export const isNcStatus = (s: unknown): s is NcStatus => typeof s === 'string' && (NC_STATUS as readonly string[]).includes(s);

export const NC_CHECK = [
  'Лична карта / пасош од сите основачи', 'Лична карта од управителот', 'Изјава / одлука за основање',
  'Изјава за прифаќање на функцијата управител', 'Доказ за адресата на седиштето (договор за закуп / имотен лист)',
  'Уплата на основачкиот влог (ако е во пари)', 'Отворање жиро сметка во банка', 'Регистрација за ДДВ (ако е потребно)',
] as const;

/** Formation form fields [key, label] (legacy `NF`). */
export const NF = [
  ['name', 'Целосен назив*'], ['short', 'Скратен назив'], ['form', 'Правна форма'], ['street', 'Улица'], ['no', 'Број'],
  ['city', 'Место'], ['muni', 'Општина'], ['postal', 'Поштенски број'], ['nkd', 'Шифра на дејност (НКД)'],
  ['activity', 'Опис на претежната дејност'], ['capital', 'Основачки влог (EUR)'], ['capType', 'Вид на влог'], ['phone', 'Телефон'],
  ['email', 'Е-пошта'], ['bank', 'Банка за сметка'], ['embs', 'ЕМБС (по регистрација)'], ['edb', 'ЕДБ (по регистрација)'],
  ['regDate', 'Датум на регистрација'], ['notes', 'Белешки'],
] as const;
export type NfKey = (typeof NF)[number][0];

export const LEGAL_FORMS = ['ДООЕЛ', 'ДОО', 'ТП', 'АД', 'Здружение'] as const;

export interface Founder { kind: 'ФЛ' | 'ПЛ'; name: string; surname?: string; embg?: string; share?: number | string; cit?: string; address?: string; city?: string; idNo?: string }
export interface CapItem { name: string; eur?: number | string; mkd?: number | string }

/**
 * Capital total in EUR and MKD (legacy `ncCapSum`).
 * FIX(#18): the EUR rate is a parameter (office setting `eurRate`) instead of the hard-coded 61.5.
 */
export function capitalSum(items: readonly CapItem[], eurRate: number): { eur: number; mkd: number } {
  let eur = 0;
  for (const x of items) eur += Number(x.eur) || (Number(x.mkd) || 0) / (eurRate || 1);
  return { eur: r2(eur), mkd: r2(eur * eurRate) };
}

/** Founder shares must add up to 100 % (one founder → 100). */
export function sharesOk(F: readonly Founder[]): boolean {
  if (!F.length) return false;
  if (F.length === 1) return true;
  return Math.abs(F.reduce((a, f) => a + (Number(f.share) || 0), 0) - 100) < 0.01;
}

/** Display name of a founder/manager (legacy `osnData.fio`). */
export const personName = (p: Pick<Founder, 'kind' | 'name' | 'surname'>) => (p.kind === 'ПЛ' ? p.name : [p.name, p.surname].filter(Boolean).join(' '));

/**
 * Legacy `ncCheck` (15000): what is still missing in a formation case, shown above the form
 * („Недостасува / проверете (n)“ or „✓ Сите основни податоци се внесени.“).
 */
export function ncCheck(n: { name?: string | null; form?: string | null; data: Record<string, string | undefined>; founders: readonly Record<string, unknown>[]; managers: readonly Record<string, unknown>[]; capEur?: number }): string[] {
  const E: string[] = [];
  const D = n.data;
  if (!n.name) E.push('Назив');
  if (!n.form) E.push('Правна форма');
  if (!D.street || !D.city) E.push('Адреса на седиштето');
  if (!D.nkd) E.push('Шифра на дејност');
  const F = n.founders as unknown as Founder[];
  if (!F.length) E.push('Барем еден основач');
  F.forEach((f, i) => {
    if (!(f.name && (f.surname || f.kind === 'ПЛ'))) E.push(`Основач ${i + 1}: име/назив`);
    if (f.kind !== 'ПЛ' && !/^\d{13}$/.test(String(f.embg ?? ''))) E.push(`Основач ${i + 1}: ЕМБГ (13 цифри)`);
    if (!f.address) E.push(`Основач ${i + 1}: адреса`);
  });
  if (n.form === 'ДООЕЛ' && F.length > 1) E.push('ДООЕЛ има само еден основач');
  const sh = F.reduce((a, f) => a + (Number(f.share) || 0), 0);
  if (F.length > 1 && Math.abs(sh - 100) > 0.01) E.push(`Уделите треба да се 100% (сега ${sh}%)`);
  const M = n.managers as unknown as Founder[];
  if (!M.length) E.push('Управител');
  // the manager's ЕМБГ may come from the founder with the same name (legacy „= основачот“)
  const nm = (p: Founder) => personName(p).trim().toLowerCase();
  M.forEach((x, i) => {
    const embg = /^\d{13}$/.test(String(x.embg ?? '')) || F.some((f) => f.kind !== 'ПЛ' && nm(f) === String(x.name ?? '').trim().toLowerCase() && /^\d{13}$/.test(String(f.embg ?? '')));
    if (!x.name || !embg) E.push(`Управител ${i + 1}: име и ЕМБГ`);
  });
  const cap = n.capEur ?? (Number(D.capital) || 0);
  if (['ДОО', 'ДООЕЛ'].includes(n.form ?? '') && cap && cap < 5000) E.push('Основачки влог под 5.000 € (проверете го важечкиот минимум)');
  if (!cap && n.form !== 'ТП') E.push('Основачки влог');
  return E;
}
