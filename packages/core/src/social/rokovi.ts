/**
 * 📅 Даночни рокови на мрежи: on the 1st of each month the worker (`social.rokovi`) posts the month's tax deadlines
 * to the office's Facebook page and Instagram – one card in Macedonian and Albanian, with a caption in both.
 * The rules are the ones the website shows (`website/main.js`): МПИН the 10th, contributions / advance payments the
 * 15th, ДДВ-04 the 25th, the annual returns 15 March; a deadline on a weekend or a public holiday moves to the next
 * working day (`rollToWorkday`, the payroll holiday list). Nothing of the firms is read.
 */
import { rollToWorkday } from '../compliance/deadlines';
import { brandCustom, brandName, brandSite } from '../brand';
import { CARD_H, CARD_W, WISE_LOGO_DATA } from './post';

export type RokKey = 'mpin' | 'pay' | 'ddv' | 'year';
export interface Rok { key: RokKey; date: string }

const pad = (n: number) => String(n).padStart(2, '0');

/** The deadlines of month `m` (1–12) of year `y`, in date order. */
export function monthDeadlines(y: number, m: number): Rok[] {
  const d = (day: number) => rollToWorkday(`${y}-${pad(m)}-${pad(day)}`);
  const out: Rok[] = [{ key: 'mpin', date: d(10) }, { key: 'pay', date: d(15) }, { key: 'ddv', date: d(25) }];
  if (m === 3) out.push({ key: 'year', date: d(15) });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.key === 'year' ? 1 : -1));
}

const TXT: Record<RokKey, { mk: [string, string]; sq: [string, string] }> = {
  mpin: { mk: ['МПИН', 'Пресметка за плата за претходниот месец'], sq: ['MPIN', 'Llogaritja e pagës për muajin e kaluar'] },
  pay: { mk: ['Придонеси', 'Плаќање придонеси и аконтации'], sq: ['Kontributet', 'Pagesa e kontributeve dhe akontacioneve'] },
  ddv: { mk: ['ДДВ-04', 'Пријава и плаќање на ДДВ'], sq: ['ДДВ-04', 'Deklarimi dhe pagesa e TVSH-së'] },
  year: { mk: ['ДБ / ДБ-ВП и ДЛД-ДБ', 'Годишни даночни пријави и годишна сметка'], sq: ['ДБ / ДБ-ВП dhe ДЛД-ДБ', 'Deklaratat vjetore dhe llogaria vjetore'] },
};
const MONTHS = {
  mk: ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'],
  sq: ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'],
};
const DAYS = {
  mk: ['недела', 'понеделник', 'вторник', 'среда', 'четврток', 'петок', 'сабота'],
  sq: ['e diel', 'e hënë', 'e martë', 'e mërkurë', 'e enjte', 'e premte', 'e shtunë'],
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const wd = (iso: string, l: 'mk' | 'sq') => DAYS[l][new Date(`${iso}T12:00:00Z`).getUTCDay()]!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The month as both languages write it: „Декември 2026“ / „Dhjetor 2026“. */
export const monthName = (y: number, m: number, l: 'mk' | 'sq') => `${cap(MONTHS[l][m - 1]!)} ${y}`;

/** The card (self-contained HTML, 1080×1350, the colours of the news card). */
export function rokoviCardHtml(y: number, m: number, o: { logo?: string | null } = {}): string {
  const items = monthDeadlines(y, m);
  const big = items.length > 3 ? 0.8 : 1;
  const rows = items.map((r) => `<div class="row"><div class="day"><b>${Number(r.date.slice(8, 10))}</b><span>${esc(wd(r.date, 'mk'))}<br>${esc(wd(r.date, 'sq'))}</span></div>
<div class="txt"><div class="h">${esc(TXT[r.key].mk[0])}</div><div class="mk">${esc(TXT[r.key].mk[1])}</div><div class="sq">${esc(TXT[r.key].sq[1])}</div></div></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0}
body{width:${CARD_W}px;height:${CARD_H}px;background:#0C3F34;color:#EEF5F1;font-family:'DejaVu Sans','Liberation Sans',Arial,sans-serif;position:relative;overflow:hidden}
.ring{position:absolute;border-radius:50%;border:2px solid rgba(143,211,185,.18)}
.wrap{position:absolute;inset:0;padding:76px 80px 64px;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between}
.logo{width:120px;height:120px;border-radius:22px;overflow:hidden;background:#111;display:flex;align-items:center;justify-content:center}
.logo img{width:100%;height:100%;object-fit:contain}
.tag{font-size:28px;font-weight:700;letter-spacing:3px;color:#0C3F34;background:#8FD3B9;padding:14px 24px;border-radius:999px}
.lbl{margin-top:48px;font-size:32px;font-weight:700;letter-spacing:3px;color:#8FD3B9;text-transform:uppercase}
h1{margin:10px 0 0;font-size:${Math.round(70 * big)}px;line-height:1.1;color:#fff}
h2{margin:6px 0 0;font-size:${Math.round(46 * big)}px;color:#8FD3B9;font-weight:700}
.rows{margin-top:${Math.round(40 * big)}px;display:flex;flex-direction:column;gap:${Math.round(22 * big)}px}
.row{display:flex;gap:30px;align-items:center;background:rgba(143,211,185,.10);border-radius:30px;padding:${Math.round(22 * big)}px 28px}
.day{width:150px;min-width:150px;height:${Math.round(150 * big)}px;border-radius:24px;background:#8FD3B9;color:#0C3F34;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.day b{font-size:${Math.round(76 * big)}px;line-height:1}
.day span{font-size:19px;font-weight:700;line-height:1.25;margin-top:4px}
.h{font-size:${Math.round(46 * big)}px;font-weight:700;color:#fff}
.mk{font-size:${Math.round(29 * big)}px;color:#CFE4DA;margin-top:6px}
.sq{font-size:${Math.round(27 * big)}px;color:#F3D98B;margin-top:4px}
.foot{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:30px;font-size:24px;color:#A9C9BC;border-top:2px solid rgba(143,211,185,.25);padding-top:24px}
.foot>div:first-child{white-space:nowrap}
.note{font-size:19px;line-height:1.35;text-align:right}
.foot b{color:#fff;font-size:30px;letter-spacing:2px}
</style></head><body>
<div class="ring" style="right:-200px;top:-200px;width:640px;height:640px"></div>
<div class="ring" style="left:-260px;bottom:-300px;width:760px;height:760px"></div>
<div class="wrap">
<div class="top"><div class="logo">${o.logo || !brandCustom() ? `<img src="${esc(o.logo || WISE_LOGO_DATA)}" alt="">` : `<b>${esc(brandName())}</b>`}</div><div class="tag">📅 РОКОВИ · AFATET</div></div>
<div class="lbl">Даночни рокови · Afatet tatimore</div>
<h1>${esc(monthName(y, m, 'mk'))}</h1>
<h2>${esc(monthName(y, m, 'sq'))}</h2>
<div class="rows">${rows}</div>
<div class="foot"><div><b>${esc(brandName())}</b><br>${esc(brandSite())}</div><div class="note">Ако рокот падне на викенд или празник – следниот работен ден.<br>Nëse bie në fundjavë ose festë – dita e parë e punës.</div></div>
</div></body></html>`;
}

const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Caption in Macedonian, then Albanian (≤ 2 200 characters). */
export function rokoviCaption(y: number, m: number): string {
  const items = monthDeadlines(y, m);
  const site = brandSite();
  const tagName = brandCustom() ? brandName().replace(/[^\p{L}\p{N}]+/gu, '') : 'WISEconsulting';
  return [
    `📅 Даночни рокови – ${MONTHS.mk[m - 1]} ${y}`,
    ...items.map((r) => `• ${dm(r.date)} (${wd(r.date, 'mk')}) – ${TXT[r.key].mk[0]}: ${TXT[r.key].mk[1]}`),
    `Ние ги следиме роковите за вас – ${brandName()}.`,
    '',
    `📅 Afatet tatimore – ${MONTHS.sq[m - 1]} ${y}`,
    ...items.map((r) => `• ${dm(r.date)} (${wd(r.date, 'sq')}) – ${TXT[r.key].sq[0]}: ${TXT[r.key].sq[1]}`),
    `Ne i ndjekim afatet për ju – ${brandName()}.`,
    site ? `\n🌐 ${site}` : '',
    `#${tagName} #сметководство #даноци #УЈП #kontabilitet #tatime`,
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').slice(0, 2200);
}
