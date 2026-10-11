/**
 * New firm from a registration decision (legacy `FS_PROMPT` / `FS_LF` / `FS_CAT` / `fsDig` / `fsNorm` / `fsDup` / `fsRead`
 * post-processing / `fsGo` firm record, 10535–10600).
 */
import { YE_LF_ENT } from '../yearend/entity';

export const FS_PROMPT = 'This is an official registration document of a business in North Macedonia: usually „Решение за упис“ / „Решение за основање“ from Централен регистар (ЦРСМ), or „Тековна состојба“ from ЦРСМ, or a УЈП decision (ЕДБ / ДДВ registration), or a decision/registration of a lawyer, notary, craftsman (занаетчија) or association (здружение). Read it carefully and reply with ONLY JSON: {"docType":"upis"|"tekovna"|"edb"|"ddv"|"other","docNumber":string (број на решение / дело број, as printed),"docDate":"YYYY-MM-DD" (date of the decision),"name":string (full registered name exactly as printed, Cyrillic),"short":string (кратко име, if printed),"legalForm":"dooel"|"doo"|"ad"|"jtd"|"kd"|"tp"|"adv"|"not"|"izv"|"zan"|"zdr"|"fon"|"soj"|"other","embs":string (матичен број / ЕМБС, digits only),"edb":string (ЕДБ / даночен број, 13 digits only, without the МК prefix),"address":string (street and number only),"city":string (место / град),"nkd":string (шифра на приоритетна дејност, e.g. "62.01"),"otherNkd":[string] (ALL other activity codes listed anywhere in the document – e.g. под „Други дејности“, „Дејности во надворешно трговско работење“, „Предмет на работење“; codes only like "46.90"; [] if none),"activity":string (name of the priority activity),"regDate":"YYYY-MM-DD" (date of founding / упис),"capital":number (основна главнина in MKD or 0),"capitalCur":string,"managers":[{"name":string,"role":string (управител / застапник)}],"founders":[{"name":string,"share":string}],"bank":string (трансакциска сметка if printed, digits only),"bankName":string,"vatFrom":"YYYY-MM-DD" (only for a ДДВ registration decision, else ""),"phone":string,"email":string}. Use "" for anything not printed. Never invent numbers.';

export const FS_CAT: Readonly<Record<string, string>> = { upis: 'Решение за упис / основање', tekovna: 'Тековна состојба (ЦРМ)', edb: 'Решение за ДДВ / ЕДБ', ddv: 'Решение за ДДВ / ЕДБ', other: 'Решение за упис / основање' };
const FS_LF: Readonly<Record<string, string>> = { kd: 'jtd', other: '' };

export const fsDig = (s: unknown) => String(s ?? '').replace(/\D/g, '');
export const fsNorm = (s: unknown) => String(s ?? '').toLowerCase().replace(/["„“”'.,]/g, '').replace(/(^|\s)(дооел|доо|ад|јтд|скопје|увоз-извоз|експорт-импорт)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();

/** Legacy `lfGuess`: legal form from the name (default `dooel`). */
export function lfGuess(name: string): string {
  const n = String(name || '').toUpperCase();
  if (/ДООЕЛ|DOOEL/.test(n)) return 'dooel';
  if (/ДОО(\s|$)|(^|\s)DOO(\s|$)/.test(n)) return 'doo';
  if (/(^|\s)АД(\s|$)|(^|\s)AD(\s|$)/.test(n)) return 'ad';
  if (/ЈТД|КД(\s|$)/.test(n)) return 'jtd';
  if (/ФОНДАЦИЈА|FONDACION/.test(n)) return 'fon';
  if (/СОЈУЗ|АСОЦИЈАЦИЈА/.test(n)) return 'soj';
  if (/ЗДРУЖЕНИЕ|SHOQATA|КЛУБ/.test(n)) return 'zdr';
  if (/АДВОКАТ|AVOKAT/.test(n)) return 'adv';
  if (/НОТАР|NOTER/.test(n)) return 'not';
  if (/ИЗВРШИТЕЛ/.test(n)) return 'izv';
  if (/ЗАНАЕТЧИ/.test(n)) return 'zan';
  if (/(^|\s)ТП(\s|$)|ТРГОВЕЦ ПОЕДИНЕЦ/.test(n)) return 'tp';
  return 'dooel';
}

export interface ReshData {
  docType: string; docNumber: string; docDate: string; name: string; short: string; lf: string; embs: string; edb: string; address: string; city: string;
  nkd: string; otherNkd: string[]; activity: string; regDate: string; capital: number; capitalCur: string; signer: string;
  founders: { name: string; share?: string }[]; bank: string; bankName: string; vatFrom: string; ddv: boolean; phone: string; email: string;
}

const isoD = (v: unknown) => {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** Legacy `fsRead` post-processing of the model JSON. */
export function normalizeResh(raw: unknown): ReshData {
  const r0 = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null;
  const r = r0 && typeof r0 === 'object' ? r0 : {};
  const legal = str(r.legalForm);
  let lf = FS_LF[legal] != null ? FS_LF[legal]! : YE_LF_ENT[legal] ? legal : '';
  const name = str(r.name);
  if (!lf && name) lf = lfGuess(name);
  const managers = Array.isArray(r.managers) ? (r.managers as { name?: unknown }[]) : [];
  const docType = FS_CAT[str(r.docType)] ? str(r.docType) : 'other';
  const vatFrom = isoD(r.vatFrom);
  return {
    docType, docNumber: str(r.docNumber), docDate: isoD(r.docDate), name, short: str(r.short), lf, embs: fsDig(r.embs), edb: fsDig(r.edb), address: str(r.address), city: str(r.city),
    nkd: str(r.nkd), otherNkd: Array.isArray(r.otherNkd) ? (r.otherNkd as unknown[]).map(str) : [], activity: str(r.activity), regDate: isoD(r.regDate),
    capital: Number(r.capital) || 0, capitalCur: str(r.capitalCur), signer: str(managers[0]?.name),
    founders: Array.isArray(r.founders) ? (r.founders as { name?: unknown; share?: unknown }[]).map((x) => ({ name: str(x.name), share: str(x.share) })).filter((x) => x.name) : [],
    bank: fsDig(r.bank), bankName: str(r.bankName), vatFrom, ddv: str(r.docType) === 'ddv' || !!vatFrom, phone: str(r.phone), email: str(r.email),
  };
}

/** Legacy `fsDup`: same ЕДБ, ЕМБС or (normalised) name. */
export function fsDup<T extends { name: string; edb: string | null; embs: string | null }>(r: Pick<ReshData, 'edb' | 'embs' | 'name'>, firms: readonly T[]): T | undefined {
  const e = fsDig(r.edb), b = fsDig(r.embs), n = fsNorm(r.name);
  return firms.find((f) => (e && fsDig(f.edb) === e) || (b && fsDig(f.embs) === b) || (n && n.length > 3 && fsNorm(f.name) === n));
}

/** Other activity codes, without the priority one (legacy `nkdOther`). */
export const otherNkd = (r: Pick<ReshData, 'otherNkd' | 'nkd'>) => [...new Set(r.otherNkd.map((x) => (x.match(/\d{2}\.\d{1,2}/) ?? [''])[0]!).filter((x) => x && x !== r.nkd))];

/* ---- v404 „Нов комитент од тековна состојба“ (legacy 13430–13455: `TK_F`, `tkMatch`, `tkRead`, `tkSave`) ---- */

/** Legacy `TK_F`: the partner fields read from the ЦРМ extract, in form order. */
export const TK_F = [['name', 'Назив'], ['edb', 'ЕДБ (даночен број)'], ['embs', 'ЕМБС'], ['address', 'Адреса'], ['city', 'Град'], ['manager', 'Управител'], ['nkd', 'Шифра на дејност'], ['activity', 'Дејност'], ['bank', 'Жиро сметка'], ['bankName', 'Банка'], ['email', 'Е-пошта'], ['phone', 'Телефон']] as const;
export type TkKey = (typeof TK_F)[number][0];
export type TkData = Record<TkKey, string> & { ddv: boolean; docDate: string; regDate: string };

/** Legacy `tkRead`: the model JSON of `FS_PROMPT` → the partner form (dates ISO, numbers digits only, first manager). */
export function tkFromRead(raw: unknown): TkData {
  const r = normalizeResh(raw);
  return { name: r.name, edb: r.edb, embs: r.embs, address: r.address, city: r.city, manager: r.signer, nkd: r.nkd, activity: r.activity, bank: r.bank, bankName: r.bankName, email: r.email, phone: r.phone, ddv: r.ddv, docDate: r.docDate, regDate: r.regDate };
}

/** Legacy `tkMatch`: an existing partner with the same ЕДБ or ЕМБС. */
export function tkMatch<T extends { edb: string | null; embs: string | null }>(r: { edb?: string | null; embs?: string | null }, partners: readonly T[]): T | undefined {
  const e = fsDig(r.edb), b = fsDig(r.embs);
  return partners.find((p) => (e && fsDig(p.edb) === e) || (b && fsDig(p.embs) === b));
}
