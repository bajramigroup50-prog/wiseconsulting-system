/**
 * The office brand of this installation. The same program runs for more than one accounting office, each on its own
 * server with its own database; the name, the short name, the icon letter and the address of the program come from
 * that server's environment (`/opt/wise/.env`: BRAND_NAME, BRAND_SHORT, BRAND_LETTER, BRAND_SITE, APP_DOMAIN). Without
 * them it is WISE CONSULTING. Server-side only (a client bundle sees the defaults).
 */
const env = (k: string): string | undefined => {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[k];
  return v && v.trim() ? v.trim() : undefined;
};

/** Full brand, e.g. „WISE CONSULTING“ / „ФЕЈКАН АКОНТИНГ“. */
export const brandName = (): string => env('BRAND_NAME') ?? 'WISE CONSULTING';
/** Short name (installed app, calendar), e.g. „WISE“. */
export const brandShort = (): string => env('BRAND_SHORT') ?? brandName().split(/\s+/)[0]!;
/** The letter of the brand mark (header, browser tab, app icon). */
export const brandLetter = (): string => env('BRAND_LETTER') ?? [...brandShort()][0]!.toUpperCase();
/** The office's web site shown on printed matter, e.g. „wiseconsulting.com.mk“. */
export const brandSite = (): string => env('BRAND_SITE') ?? (env('BRAND_NAME') ? (env('APP_DOMAIN') ?? '').replace(/^app\./, '') : 'wiseconsulting.com.mk');
/** The program's address (links in QR codes, e-mails), no trailing slash. */
export const appUrl = (): string => {
  const d = env('APP_DOMAIN');
  return d ? `https://${d.replace(/^https?:\/\//, '').replace(/\/+$/, '')}` : 'https://app.wiseconsulting.com.mk';
};
/** True on a server with its own brand (not WISE): WISE's own logo and hashtags are not used there. */
export const brandCustom = (): boolean => !!env('BRAND_NAME');
