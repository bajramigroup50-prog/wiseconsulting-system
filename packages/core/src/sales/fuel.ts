/**
 * Fuel VAT rule for documents (legacy 14350–14362): fuel lines are recognised by name (`FUEL_RX`); the rate in force
 * comes from the law feed (`fuelRate` in `../law/robot`). Outgoing invoices: the user is offered an automatic fix of
 * the line rates. Incoming invoices: a warning only (the supplier decides the rate).
 */
import type { FuelRule } from '../law/robot';

/** Legacy `FUEL_RX` (14350). */
export const FUEL_RX = /(еуро\s*дизел|евродизел|дизел|бензин|безоловн|eurodiesel|euro\s*diesel|diesel|dizel|benzin|bezolovn|нафта|lpg|лпг|автогас|autogas|пропан|мазут|кероз|гориво|goriv|bmb\s*9|ед\s*-?\s*1|ulsd)/i;
/** Legacy `isFuel` (14351). */
export const isFuel = (n: unknown): boolean => FUEL_RX.test(String(n ?? ''));

export interface FuelRateAt { rate: number; R: FuelRule; inR: boolean }

const dmy = (d: string) => d.slice(0, 10).split('-').reverse().join('.');

/** Rate in force on a date (legacy `fuelRate`), from an already resolved rule. */
export function fuelRateAt(R: FuelRule | null, date: string): FuelRateAt | null {
  if (!R) return null;
  const d = String(date || '').slice(0, 10);
  const inR = (!R.from || d >= R.from) && (!R.to || d <= R.to);
  return { rate: inR ? R.rate : R.else, R, inR };
}

/**
 * Outgoing invoice check (legacy `fuelMsgFor` 14356): fuel lines whose VAT rate differs from the rate in force.
 * Returns the indexes of the bad lines and the legacy message text, or null.
 */
export function fuelInvoiceCheck(lines: readonly { name: string; rate: string | number | null | undefined }[], date: string, R: FuelRule | null, label = 'Фактура'):
  { rate: number; bad: number[]; text: string } | null {
  const fr = fuelRateAt(R, date);
  if (!fr) return null;
  const bad = lines.map((l, i) => [l, i] as const).filter(([l]) => isFuel(l.name) && l.rate != null && l.rate !== '' && Number(l.rate) !== fr.rate).map(([, i]) => i);
  if (!bad.length) return null;
  const B = bad.map((i) => lines[i]!);
  const text = `⛽ ${label}: ${B.length === 1 ? 'ставката' : B.length + ' ставки'} „${B.slice(0, 3).map((l) => l.name).join('“, „')}“ ${B.length === 1 ? 'е гориво' : 'се гориво'} со ДДВ ${[...new Set(B.map((l) => Number(l.rate)))].join('/')}%.\n\n`
    + `На ${dmy(date)} ДДВ за гориво е ${fr.rate}%${fr.inR ? ` (намалена стапка ${fr.R.to ? 'до ' + dmy(fr.R.to) : ''})` : fr.R.to ? ` (намалената стапка 10% важеше до ${dmy(fr.R.to)})` : ''}.\nИзвор: ${fr.R.title}`;
  return { rate: fr.rate, bad, text };
}

/**
 * Incoming invoice warning (legacy `savePur` wrapper 14361): a fuel purchase (stock line names, memo or supplier name
 * match `FUEL_RX`) booked with VAT rates that do not include the rate in force. Returns the confirm text or null.
 */
export function fuelPurchaseWarning(p: { names: readonly (string | null | undefined)[]; groups: readonly { rate: string | number; base: string | number }[]; date: string }, R: FuelRule | null): string | null {
  if (!p.names.some(isFuel)) return null;
  const fr = fuelRateAt(R, p.date);
  if (!fr) return null;
  const rates = [...new Set(p.groups.filter((g) => Number(g.base)).map((g) => Number(g.rate)))];
  if (!rates.length || rates.includes(fr.rate)) return null;
  return `⛽ Влезна фактура за гориво со ДДВ ${rates.join('/')}%.\nНа ${dmy(p.date)} ДДВ за гориво е ${fr.rate}%${fr.R.to ? ' (намалената 10% важи до ' + dmy(fr.R.to) + ')' : ''}.\n\n`
    + 'Проверете ја фактурата од добавувачот. Ако е грешна – побарајте корекција (одобрение/нова фактура).\nДа се зачува сепак?';
}

/**
 * Banner for firms that sell fuel (legacy `fuelBanner` 14368) on Излез / Артикли / fiscal screens.
 * `wrong` = fuel items with another VAT rate.
 */
export function fuelBannerData(R: FuelRule | null, today: string, seller: boolean, fuelItems: readonly { rate: number }[]):
  { rate: number; inR: boolean; to: string; else: number; left: number | null; wrong: number; warn: boolean } | null {
  const fr = fuelRateAt(R, today);
  if (!fr || (!seller && !fuelItems.length)) return null;
  const left = fr.R.to ? Math.round((Date.parse(fr.R.to) - Date.parse(today.slice(0, 10))) / 864e5) : null;
  const wrong = fuelItems.filter((i) => Number(i.rate) !== fr.rate).length;
  return { rate: fr.rate, inR: fr.inR, to: fr.R.to, else: fr.R.else, left, wrong, warn: !!wrong || (left != null && left <= 7) };
}
