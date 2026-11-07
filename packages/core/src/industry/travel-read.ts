/**
 * Reading a travel order (патен налог) of a transport client with AI: driver, vehicle, departure / return and every
 * foreign country with the date and hour of entry and exit — the data the per diems abroad are computed from
 * (`frPerDiems`, Уредба за дневници). `normalizeTravelRead` maps country names (Macedonian, English, local, codes) to
 * the `FR_COUNTRIES` codes and the times to `YYYY-MM-DDTHH:MM`.
 */
import { FR_COUNTRIES, type FreightSegment } from './transport';

export const TRAVEL_ORDER_PROMPT = `This is a travel order (патен налог / налог за службено патување) of a Macedonian transport company for a truck driver, possibly with the border crossing records (дневник на патување, излез / влез на граница). Reply with ONLY JSON:
{"number":string (the travel order number),"date":string (YYYY-MM-DD, issue date),"driver":string,"driverEmbg":string,"plate":string (truck registration, e.g. "SK-1234-AB"),"trailer":string,"route":string (e.g. "Скопје – Минхен – Скопје"),"departure":string (YYYY-MM-DDTHH:MM, leaving the home base),"return":string (YYYY-MM-DDTHH:MM, back at the base),"km":number|null,"advance":number|null (cash advance given to the driver),"advanceCur":string,
"countries":[{"country":string (country name or code as printed, e.g. "Германија", "Austria", "DE"),"in":string (YYYY-MM-DDTHH:MM, entering the country),"out":string (YYYY-MM-DDTHH:MM, leaving it)}]}
List ONLY foreign countries (not North Macedonia), in the order travelled; when the same country is entered twice (going and returning), list it twice. Use "" / null for what is not in the document. Never invent times.`;

export interface TravelRead {
  number: string; date: string; driver: string; driverEmbg: string; plate: string; trailer: string; route: string;
  departure: string; ret: string; km: number | null; advance: number | null; advanceCur: string;
  segs: FreightSegment[]; unknown: string[];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const num = (v: unknown): number | null => { const n = typeof v === 'number' ? v : Number(str(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) && str(v) !== '' ? n : null; };
const dt = (v: unknown): string => {
  const s = str(v);
  const a = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(s);
  if (a) return `${a[1]}T${a[2]!.padStart(2, '0')}:${a[3]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00';
  const b = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\D+(\d{1,2})[:.](\d{2}))?/.exec(s);
  return b ? `${b[3]}-${b[2]!.padStart(2, '0')}-${b[1]!.padStart(2, '0')}T${(b[4] ?? '00').padStart(2, '0')}:${b[5] ?? '00'}` : '';
};

/** Country name / code → FR_COUNTRIES code ('' when unknown). */
const ALIAS: Record<string, string> = {
  germany: 'DE', deutschland: 'DE', austria: 'AT', österreich: 'AT', osterreich: 'AT', serbia: 'RS', srbija: 'RS', србија: 'RS', croatia: 'HR', hrvatska: 'HR',
  slovenia: 'SI', slovenija: 'SI', hungary: 'HU', magyarország: 'HU', italy: 'IT', italia: 'IT', greece: 'GR', ελλάδα: 'GR', bulgaria: 'BG', българия: 'BG',
  kosovo: 'XK', kosova: 'XK', albania: 'AL', shqipëria: 'AL', shqiperia: 'AL', france: 'FR', netherlands: 'NL', holland: 'NL', belgium: 'BE', poland: 'PL', polska: 'PL',
  czechia: 'CZ', 'czech republic': 'CZ', slovakia: 'SK', romania: 'RO', românia: 'RO', switzerland: 'CH', schweiz: 'CH', turkey: 'TR', türkiye: 'TR',
  bosnia: 'BA', 'bosnia and herzegovina': 'BA', montenegro: 'ME', 'crna gora': 'ME', denmark: 'DK', sweden: 'SE', norway: 'NO', spain: 'ES', luxembourg: 'LU',
};
export function countryCode(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  const up = s.toUpperCase();
  if (FR_COUNTRIES.some((c) => c[0] === up)) return up;
  const low = s.toLowerCase();
  const byName = FR_COUNTRIES.find((c) => c[1].toLowerCase() === low) ?? FR_COUNTRIES.find((c) => low.startsWith(c[1].toLowerCase().split(' ')[0]!));
  if (byName) return byName[0];
  return ALIAS[low] ?? ALIAS[low.split(/[ ,(]/)[0]!] ?? '';
}

export function normalizeTravelRead(x: unknown): TravelRead {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const unknown: string[] = [];
  const segs = (Array.isArray(o.countries) ? o.countries : []).map((c) => {
    const r = (c ?? {}) as Record<string, unknown>;
    // the home country is not travel abroad
    if (/^(mk|мк|mkd|македонија|северна македонија|north macedonia|macedonia)$/i.test(str(r.country))) return { c: '', in: '', out: '' };
    const code = countryCode(r.country);
    if (!code && str(r.country)) unknown.push(str(r.country));
    return { c: code, in: dt(r.in), out: dt(r.out) };
  }).filter((g) => g.c);
  return {
    number: str(o.number), date: /^\d{4}-\d{2}-\d{2}$/.test(str(o.date)) ? str(o.date) : dt(o.date).slice(0, 10), driver: str(o.driver), driverEmbg: str(o.driverEmbg).replace(/\D/g, ''),
    plate: str(o.plate).toUpperCase(), trailer: str(o.trailer).toUpperCase(), route: str(o.route), departure: dt(o.departure), ret: dt(o.return),
    km: num(o.km), advance: num(o.advance), advanceCur: str(o.advanceCur).toUpperCase() || 'EUR', segs, unknown,
  };
}
