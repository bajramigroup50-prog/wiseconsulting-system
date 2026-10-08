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
  ['activity', 'Опис на дејноста'], ['capital', 'Основачки влог (EUR)'], ['capType', 'Вид на влог'], ['phone', 'Телефон'],
  ['email', 'Е-пошта'], ['bank', 'Банка за сметка'], ['embs', 'ЕМБС (по регистрација)'], ['edb', 'ЕДБ (по регистрација)'],
  ['regDate', 'Датум на регистрација'], ['notes', 'Белешки'],
] as const;
export type NfKey = (typeof NF)[number][0];

export const LEGAL_FORMS = ['ДООЕЛ', 'ДОО', 'ТП', 'АД', 'Здружение'] as const;

export interface Founder { kind: 'ФЛ' | 'ПЛ'; name: string; surname?: string; embg?: string; share?: number | string; cit?: string; address?: string; city?: string }
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
