/**
 * ⚖️ Законски промени — the daily law robot and its list (legacy v464 `VIEWS.zakoni` 14323, `LAW_INST`, `LAW_IMP`,
 * `lawNew`, `lawFirms`, `lawAsk`, v465 robot figure).
 *
 * In legacy the robot itself was an external scheduled task that wrote `applaw` documents; the program only showed
 * them. Here it is the worker job `law.robot` (daily 06:52, Europe/Skopje): it fetches the watched УЈП and Службен
 * весник pages, finds links that were not there at the previous check (`lawLinks` / `lawNewLinks`), asks the model to
 * keep the ones that change laws relevant to an accounting office and describe them (`LAW_ROBOT_PROMPT`), normalises
 * the answer (`lawNorm`) and stores new entries; when there are any, the office gets an e-mail.
 */
import { dmy } from '../office/dates';

/** Legacy `LAW_INST`. */
export const LAW_INST: Record<string, string> = {
  UJP: 'УЈП', UFR: 'УФР', CRM: 'ЦРМ', DPI: 'ДПИ', DIT: 'ДИТ (труд)', AVRM: 'АВРМ', PIOM: 'ПИОМ', FZOM: 'ФЗОМ', CU: 'Царина',
  MF: 'Министерство за финансии', ME: 'Министерство за економија и труд', MDT: 'Министерство за дигитална трансформација',
  MT: 'Министерство за транспорт', MVR: 'МВР – странци', MTSP: 'Социјална политика (МСПДМ)', SV: 'Службен весник', ISOS: 'ИСОС',
  NBRM: 'НБРМ', VLADA: 'Влада', OTHER: 'Друго',
};
/** Legacy `LAW_IMP`. */
export const LAW_IMP: Record<string, string> = {
  ddv: 'ДДВ обврзници', plati: 'фирми со вработени', site: 'сите фирми', gorivo: 'гориво / енергенти', smetk: 'сметководители (канцеларија)',
  crm: 'годишни сметки / упис', stranci: 'фирми со странски работници', transport: 'превозници', digital: 'е-услуги / дигитален потпис',
};

export interface LawSource { url: string; inst: string; name: string; /** Links that are items (announcements, gazette issues, law texts). */ pick: RegExp }

const UJP = 'https://www.ujp.gov.mk';
/** Pages the robot watches: УЈП announcements and tax regulations, the УЈП law areas, Службен весник free issues. */
export const LAW_SOURCES: readonly LawSource[] = [
  { url: `${UJP}/mk`, inst: 'UJP', name: 'УЈП – соопштенија', pick: /\/soopstenija\/pogledni\/\d+/i },
  { url: `${UJP}/mk/regulativa`, inst: 'UJP', name: 'УЈП – даночна регулатива', pick: /\/regulativa\/|\/files\/attachment\//i },
  ...['ddv', 'dd', 'pd', 'pridonesi', 'fis', 'reg', 'drugo'].map((k) => ({ url: `${UJP}/mk/regulativa/pregled/tipovi/${k}`, inst: 'UJP', name: `УЈП – прописи (${k})`, pick: /\/regulativa\/opis\/|\/files\/attachment\//i })),
  { url: 'https://www.slvesnik.com.mk/besplatni-izdanija.nspx', inst: 'SV', name: 'Службен весник – бесплатни изданија', pick: /issue|izdanie|\.pdf|besplatni-izdanija\.nspx\?/i },
];

export interface LawLink { url: string; text: string }

/** WHATWG URL (Node / browser global; core has no DOM lib types). */
const Url = (globalThis as unknown as { URL: new (u: string, b?: string) => { toString(): string } }).URL;

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const unent = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, k: string) => ENT[k]!).replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(+n));

/** Anchors of a page as absolute URLs with their text (no scripts / mail / anchors), first occurrence wins. */
export function lawLinks(html: string, base: string): LawLink[] {
  const out: LawLink[] = [];
  const seen = new Set<string>();
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
  for (const m of body.matchAll(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = unent(m[2]!.trim());
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let url: string;
    try { url = new Url(href, base).toString(); } catch { continue; }
    const text = unent(m[3]!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const k = lawKey(url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ url, text });
  }
  return out;
}

/** Dedupe key of a URL: no scheme, no `www.`, no fragment, no trailing slash, lower case. */
export const lawKey = (url: string): string => url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

/** Item links of a source that were not there at the previous check. `prev = null` → first check (baseline, nothing new). */
export function lawNewLinks(src: Pick<LawSource, 'pick'>, links: readonly LawLink[], prev: readonly string[] | null): { items: LawLink[]; fresh: LawLink[] } {
  const items = links.filter((l) => src.pick.test(l.url) && l.text.length >= 4);
  if (!prev) return { items, fresh: [] };
  const P = new Set(prev.map(lawKey));
  return { items, fresh: items.filter((l) => !P.has(lawKey(l.url))) };
}

/** Plain text of a page (for the model), limited. */
export function lawPageText(html: string, max = 8000): string {
  return unent(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n\s*\n+/g, '\n').trim().slice(0, max);
}

/** Prompt for one source's new items (the robot's job, written for the rebuild). */
export function lawRobotPrompt(src: Pick<LawSource, 'inst' | 'name'>, items: readonly { url: string; text: string; page?: string }[], today: string): string {
  return `Ти си роботот за законски промени на сметководствена канцеларија во Северна Македонија. Денес е ${today}. Ова се НОВИ објави на „${src.name}“ (институција: ${LAW_INST[src.inst] ?? src.inst}).
За секоја објава одлучи дали менува или објаснува закон, подзаконски акт, стапка, рок, образец или постапка што е важна за сметководители и нивните клиенти (ДДВ, данок на добивка, персонален данок, придонеси и плати, фискализација, е-фактура, годишни сметки, благајна, странци, превоз, дигитални услуги). Вработувања, тендери, настани и општи вести НЕ се важни.
Reply ONLY JSON {"items":[{"url":"линкот од објавата","relevant":true|false,"inst":"${Object.keys(LAW_INST).join('|')}","title":"краток наслов на македонски","what":"што се менува, 1–3 реченици, со броеви/стапки/рокови само ако се во текстот","who":"на кого се однесува","impact":["${Object.keys(LAW_IMP).join('","')}"],"date":"YYYY-MM-DD објавено","from":"YYYY-MM-DD важи од или празно","to":"YYYY-MM-DD важи до или празно"}]}. Никогаш не измислувај броеви на Службен весник, рокови или стапки.

ОБЈАВИ:
${items.map((x, i) => `[${i + 1}] ${x.text}\n${x.url}${x.page ? '\n' + x.page : ''}`).join('\n\n')}`;
}

export interface LawEntry {
  key: string; inst: string; title: string; what: string | null; who: string | null; impact: string[]; date: string | null;
  from: string | null; to: string | null; urls: string[]; verified: boolean;
}

const isoD = (v: unknown): string | null => { const s = String(v ?? '').trim(); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[0]; const d = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s); return d ? `${d[3]}-${d[2]!.padStart(2, '0')}-${d[1]!.padStart(2, '0')}` : null; };
const str = (v: unknown, max = 2000): string | null => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

/**
 * The model's answer → entries: only relevant ones, URL taken from the item list (never invented), institution and
 * impact restricted to the known keys. Items the model did not mention are dropped.
 */
export function lawNorm(ans: unknown, src: Pick<LawSource, 'inst'>, items: readonly LawLink[], today: string): LawEntry[] {
  const A = (Array.isArray(ans) ? ans : (ans as { items?: unknown[] } | null)?.items) ?? [];
  const byKey = new Map(items.map((l) => [lawKey(l.url), l]));
  const out: LawEntry[] = [];
  for (const x0 of A as Record<string, unknown>[]) {
    if (!x0 || x0.relevant === false) continue;
    const link = byKey.get(lawKey(String(x0.url ?? '')));
    if (!link) continue;
    const inst = typeof x0.inst === 'string' && LAW_INST[x0.inst] ? x0.inst : src.inst;
    const impact = Array.isArray(x0.impact) ? [...new Set(x0.impact.filter((k): k is string => typeof k === 'string' && k in LAW_IMP))] : [];
    out.push({
      key: lawKey(link.url), inst, title: str(x0.title, 300) ?? link.text.slice(0, 300), what: str(x0.what), who: str(x0.who, 300), impact,
      date: isoD(x0.date) ?? today, from: isoD(x0.from), to: isoD(x0.to), urls: [link.url], verified: true,
    });
  }
  return out;
}

/** Without the model: every new item becomes an entry „да се потврди“ with the link text as title. */
export const lawRaw = (src: Pick<LawSource, 'inst'>, items: readonly LawLink[], today: string): LawEntry[] =>
  items.map((l) => ({ key: lawKey(l.url), inst: src.inst, title: l.text.slice(0, 300), what: null, who: null, impact: [], date: today, from: null, to: null, urls: [l.url], verified: false }));

export interface LawRow { inst: string; title: string; what?: string | null; who?: string | null; impact?: readonly string[] | null; date?: string | null; from?: string | null; to?: string | null; urls?: readonly string[] | null; at: string }

/** Legacy `lawNew`: entries after the user's „прочитано“ mark. */
export const lawNew = <T extends LawRow>(L: readonly T[], seen: string | null): T[] => L.filter((x) => String(x.at || x.date || '') > (seen ?? ''));

/** Legacy `lawFirms`: how many of the office's firms an entry concerns (all / VAT payers). */
export function lawFirms(x: Pick<LawRow, 'impact'>, firms: readonly { vat: boolean }[]): number {
  const im = x.impact ?? [];
  if (im.includes('site')) return firms.length;
  if (im.includes('ddv')) return firms.filter((f) => f.vat).length;
  return 0;
}

/** Legacy filter: institution + text search over title, what, who and the institution name. */
export const lawFilter = <T extends LawRow>(L: readonly T[], inst: string, q: string): T[] => {
  const s = q.trim().toLowerCase();
  return L.filter((x) => (!inst || x.inst === inst) && (!s || [x.title, x.what, x.who, LAW_INST[x.inst]].join(' ').toLowerCase().includes(s)));
};

/** Legacy `lawAsk` prompt (14332) with the records as context (newest 80). */
export function lawAskPrompt(L: readonly LawRow[], q: string, today: string): string {
  const ctx = L.slice(0, 80).map((x, i) => `[${i + 1}] ${LAW_INST[x.inst] || x.inst} | ${x.date || ''} | ${x.title} | ${x.what || ''} | важи ${x.from || ''}${x.to ? ' до ' + x.to : ''} | ${(x.urls ?? []).filter(Boolean).join(' ')}`).join('\n');
  return `Ти си помошник за сметководствена канцеларија во Северна Македонија. Денес е ${today}. Одговори кратко и прецизно на прашањето, на јазикот на прашањето (македонски или албански). Користи ги ПРВЕНСТВЕНО записите подолу (собрани од официјални извори) и цитирај ги со [број] и линк. Ако одговорот не е во записите, кажи јасно дека нема запис и дај го твоето општо знаење со напомена „да се провери на официјален извор“. Никогаш не измислувај броеви на Службен весник, рокови или стапки. На крај: „Ова не е правен совет.“\n\nЗАПИСИ:\n${ctx || '(нема)'}\n\nПРАШАЊЕ: ${q}`;
}

/** E-mail to the office about new entries. */
export function lawMailHtml(E: readonly Pick<LawEntry, 'inst' | 'title' | 'what' | 'urls' | 'from' | 'to'>[], appUrl = ''): { subject: string; html: string } {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return {
    subject: `⚖️ ${E.length} нови законски промени`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5"><p>Роботот за законски промени најде <b>${E.length}</b> нови записи:</p><ul>`
      + E.map((x) => `<li><b>${esc(LAW_INST[x.inst] ?? x.inst)}</b> – ${esc(x.title)}${x.what ? `<br>${esc(x.what)}` : ''}${x.from ? `<br>Важи од ${dmy(x.from)}${x.to ? ' до ' + dmy(x.to) : ''}` : ''}${x.urls[0] ? `<br><a href="${esc(x.urls[0])}">Извор</a>` : ''}</li>`).join('')
      + `</ul>${appUrl ? `<p><a href="${esc(appUrl)}/zakoni">Отвори „Законски промени“</a></p>` : ''}<p style="color:#777">Ова не е правен совет – секогаш проверете го изворот.</p></div>`,
  };
}

/** Legacy `fuelRule` (v465): VAT rate for fuel from a law entry (`rule.kind='vatRate'`, `match='gorivo'`) or the default 10% / 18% for a dated fuel entry. */
export interface FuelRule { rate: number; else: number; from: string; to: string; title: string; url: string }
export function fuelRule(L: readonly (LawRow & { rule?: Record<string, unknown> | null })[]): FuelRule | null {
  const r = L.find((x) => x.rule && x.rule.kind === 'vatRate' && x.rule.match === 'gorivo');
  if (r) return { rate: Number(r.rule!.rate), else: Number(r.rule!.else) || 18, from: String(r.rule!.from || r.from || ''), to: String(r.rule!.to || r.to || ''), title: r.title, url: (r.urls ?? [])[0] ?? '' };
  const g = L.find((x) => (x.impact ?? []).includes('gorivo') && x.to);
  return g ? { rate: 10, else: 18, from: g.from ?? '', to: g.to!, title: g.title, url: (g.urls ?? [])[0] ?? '' } : null;
}
/** Legacy `fuelRate(date)`. */
export function fuelRate(L: Parameters<typeof fuelRule>[0], date: string): { rate: number; R: FuelRule; inR: boolean } | null {
  const R = fuelRule(L);
  if (!R) return null;
  const d = date.slice(0, 10);
  const inR = (!R.from || d >= R.from) && (!R.to || d <= R.to);
  return { rate: inR ? R.rate : R.else, R, inR };
}
