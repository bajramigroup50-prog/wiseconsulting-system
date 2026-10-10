/**
 * Client-portal profiles (legacy `klUserName` / `klStrongPw` / `KL_TR` / `KL_STOP` 9150–9162): the username is a
 * word of the firm name in Latin + "." + 4 random characters (e.g. `bajrami.k7m2`, never a sequence number), the
 * password three groups of 4 (e.g. `Kp7m-Xq3v-Rt9w`). Randomness is injected (`rnd(n)` → n random uint32).
 */
export type Rnd = (n: number) => ArrayLike<number>;

const KL_ALN = 'abcdefghjkmnpqrstuvwxyz23456789', KL_UP = 'ABCDEFGHJKLMNPQRSTUVWXYZ', KL_LO = 'abcdefghjkmnpqrstuvwxyz', KL_DG = '23456789';
const pick = (A: string, n: number, rnd: Rnd) => Array.from(rnd(n), (x) => A[x % A.length]).join('');

/** Legacy `klStrongPw`. */
export function klStrongPw(rnd: Rnd): string {
  for (;;) {
    const p = [0, 1, 2].map(() => pick(KL_UP + KL_LO + KL_DG, 4, rnd)).join('-');
    if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)) return p;
  }
}

const KL_TR: Record<string, string> = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ѓ': 'gj', 'е': 'e', 'ж': 'zh', 'з': 'z', 'ѕ': 'dz', 'и': 'i', 'ј': 'j', 'к': 'k', 'л': 'l', 'љ': 'lj', 'м': 'm', 'н': 'n', 'њ': 'nj', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'ќ': 'kj', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'џ': 'dj', 'ш': 'sh', 'ë': 'e', 'ç': 'c' };
const KL_STOP = new Set(['друштво', 'за', 'трговија', 'трговско', 'услуги', 'производство', 'производно', 'и', 'на', 'увоз', 'извоз', 'увоз-извоз', 'доо', 'дооел', 'ад', 'тп', 'јтд', 'експорт', 'импорт', 'скопје', 'промет', 'градежништво', 'угостителство', 'транспорт', 'консалтинг', 'dooel', 'doo', 'shpk']);

/** Legacy `klUserName`: unique (case-insensitive) against `used`. */
export function klUserName(f: { name: string; short?: string | null }, used: ReadonlySet<string>, rnd: Rnd): string {
  const nm = String(f.short || f.name || '').toLowerCase().replace(/["„“”'.,()]/g, ' ');
  const w = nm.split(/\s+/).filter((x) => x && !KL_STOP.has(x) && /[a-zа-шѓќљњџѕј]/.test(x))[0] || 'klient';
  const lat = [...w].map((ch) => KL_TR[ch] ?? ch).join('').replace(/[^a-z]/g, '').slice(0, 8) || 'klient';
  for (;;) {
    const u = lat + '.' + pick(KL_ALN, 4, rnd);
    if (!used.has(u)) return u;
  }
}

export interface KlCred { firm: string; edb: string | null; username: string; password: string }

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Legacy `klCredHTML`: printable access-data slips. */
export function klCredHtml(L: readonly KlCred[], date: string): string {
  return `<h2 style="font-size:14pt;margin:0 0 4mm">ПРИСТАПНИ ПОДАТОЦИ – ПОРТАЛ ЗА КЛИЕНТИ <span style="font-weight:400;font-size:10pt">${esc(date)}</span></h2>` + L.map((u) =>
    `<div style="border:1px dashed #555;border-radius:6px;padding:10px 14px;margin:0 0 10px;page-break-inside:avoid"><b style="font-size:12pt">${esc(u.firm)}</b>${u.edb ? ' · ЕДБ ' + esc(u.edb) : ''}<table style="margin-top:6px;width:auto"><tr><td style="padding:2px 14px 2px 0">Корисничко име:</td><td><b style="font-size:13pt">${esc(u.username)}</b></td></tr><tr><td style="padding:2px 14px 2px 0">Лозинка:</td><td><b style="font-size:13pt">${esc(u.password)}</b></td></tr></table><div style="font-size:8.5pt;color:#555;margin-top:4px">По првата најава сменете ја лозинката во „Мојот профил / лозинка“.</div></div>`).join('');
}
