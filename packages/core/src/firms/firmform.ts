/**
 * Firm editor (legacy `firmForm` 6833 + `firmFormVals` 6830 + patch 13587 „Сметководствени услуги“) and the firm
 * list report (legacy `FR_F` / `frList` / `frPdfHTML` / `frXlsx` 12069–12081).
 *
 * Columns of `firms` keep their own names (`name`, `edb`, `lf` → `legalForm`, `ddv` → `vatRegistered`,
 * `per` → `vatPeriod`, `lock` → `lockDate`); every other legacy field is stored under its legacy key in
 * `firms.settings`, so the importer, invoice print, payroll and VAT readers find them where legacy had them.
 */

/** Editor tabs (legacy `FTABS`). */
export const FIRM_TABS = [['osn', 'Основни податоци'], ['dop', 'Дополнителни податоци'], ['pl', 'Податоци за плата'], ['ef', 'е-Фактура']] as const;
export type FirmTab = (typeof FIRM_TABS)[number][0];

/** Text settings of the editor, in legacy key names (stored trimmed; empty → removed). */
export const FIRM_TEXT_KEYS = [
  // Основни податоци
  'fax', 'phone2', 'bank', 'realBank', 'bank2', 'regNo', 'bankName', 'bankName2', 'bankEdb', 'bankAcc', 'depositor',
  'opstina', 'opstina2', 'payCode', 'opstinaOther', 'contact', 'signer', 'signerRole', 'kontoPlan', 'repro',
  'gdvpYear', 'curYear', 'parent', 'invStyle', 'invColor', 'legalFoot', 'short', 'accFrom',
  // Дополнителни податоци
  'retailCode', 'serial', 'instTo', 'debitAcct', 'payForm', 'contribForm', 'payslip', 'accReg', 'vatInKonto',
  'dc_name', 'dc_edb', 'dc_first', 'dc_last', 'dc_street', 'dc_no', 'dc_phone', 'dc_mob', 'dc_city',
  'ro_first', 'ro_last', 'ro_city', 'ro_embg', 'ro_street', 'ro_no', 'ro_phone', 'ro_mob',
  // Податоци за плата
  'payType', 'craft', 'protect', 'taxPayer', 'avgMode', 'payLocked', 'lawyer',
  // е-Фактура
  'ef_taxNo', 'ef_contact', 'ef_email', 'epdd', 'cert_serial', 'cert_thumb',
] as const;
export type FirmTextKey = (typeof FIRM_TEXT_KEYS)[number];

/** Checkbox settings (legacy `transport`, `qr` — `qr` defaults to on). */
export const FIRM_BOOL_KEYS = ['transport', 'qr'] as const;
/** Image settings (`files.id` of the uploaded logo / signature / stamp). */
export const FIRM_IMG_KEYS = ['logo', 'sign', 'stamp'] as const;
/** VAT rates with their own input/output accounts on the „Дополнителни податоци“ tab. */
export const FIRM_VAT_RATES = [[18, '130018', '230018'], [10, '130010', '230010'], [5, '13005', '23005']] as const;
/** Collective VAT accounts the program never posts to (legacy `VAT_BAD`): such overrides are ignored. */
export const VAT_BAD = new Set(['2300', '230', '1300', '130', '23000', '13000', '2301', '2302', '1301', '1302']);
export const vOk = (v: unknown): boolean => !!v && !VAT_BAD.has(String(v).trim());

export const FIRM_DEFAULTS: Partial<Record<FirmTextKey, string>> = {
  payCode: '0', signerRole: 'Управител', kontoPlan: 'std', repro: 'nedef', invStyle: 'classic', invColor: '#1f5eff', legalFoot: 'auto',
  retailCode: 'Д', serial: 'nedef', payType: 'firma', craft: 'Н', protect: '', taxPayer: 'Д', avgMode: 'saat', payLocked: 'Н', lawyer: 'Н',
};

export interface FirmFormInput {
  /** Raw form values (strings). */
  text: Readonly<Record<string, string | undefined>>;
  /** Checked checkboxes. */
  checked: ReadonlySet<string>;
  /** Current settings (kept for every key the form does not own). */
  settings: Readonly<Record<string, unknown>>;
  /** `vatIn`/`vatOut` per rate, as typed. */
  vatIn?: Readonly<Record<string, string | undefined>>;
  vatOut?: Readonly<Record<string, string | undefined>>;
  /** Show the „Сметководствени услуги“ fee fields (not for the office's own firm, not for clients). */
  withFee?: boolean;
}

export type FirmFormResult =
  | { ok: true; settings: Record<string, unknown> }
  | { ok: false; error: string };

const ymd = /^\d{4}-\d{2}-\d{2}$/;

/** Merge the editor values into `firms.settings` (legacy `firmFormVals`), with the legacy checks. */
export function firmSettingsFrom(i: FirmFormInput): FirmFormResult {
  const s: Record<string, unknown> = { ...i.settings };
  for (const k of FIRM_TEXT_KEYS) {
    if (k === 'accFrom' && !i.withFee) continue;
    const v = (i.text[k] ?? '').trim();
    if (v) s[k] = v; else delete s[k];
  }
  for (const k of FIRM_BOOL_KEYS) s[k] = i.checked.has(k);
  // invoice note: legacy keeps '' (= no note) apart from „not set“ (= INV_NOTE0)
  if (i.text.invNote !== undefined) s.invNote = String(i.text.invNote).replace(/\r\n/g, '\n').trim();
  for (const k of FIRM_IMG_KEYS) {
    const v = i.text[k];
    if (v === undefined) continue;
    if (v.trim()) s[k] = v.trim(); else delete s[k];
  }
  if (i.vatIn || i.vatOut) {
    const vi: Record<string, string> = {}, vo: Record<string, string> = {};
    for (const [r] of FIRM_VAT_RATES) {
      const a = (i.vatIn?.[r] ?? '').trim(), b = (i.vatOut?.[r] ?? '').trim();
      // legacy shows a collective account (VAT_BAD) as empty, so it is never saved
      if (vOk(a)) vi[r] = a;
      if (vOk(b)) vo[r] = b;
    }
    s.vatIn = vi; s.vatOut = vo;
  }
  if (s.bank) s.bankAccount = s.bank; // readers of the server port use `bankAccount`
  else delete s.bankAccount;
  if (i.withFee) {
    const fee = (i.text.accFee ?? '').trim().replace(',', '.');
    if (fee) {
      if (!/^\d+(\.\d{1,2})?$/.test(fee)) return { ok: false, error: 'Месечниот надоместок е износ (на пр. 3000 или 3000.50).' };
      s.accFee = fee;
    } else delete s.accFee;
    if (s.accFrom && !ymd.test(String(s.accFrom))) return { ok: false, error: 'Фактурирај од: неважечки датум.' };
  }
  if (s.invColor && !/^#[0-9a-f]{6}$/i.test(String(s.invColor))) s.invColor = '#1f5eff';
  return { ok: true, settings: s };
}

/** Legacy `copyDC`: составувач → одговорно лице, only into empty fields. */
export const DC_TO_RO = [['first', 'first'], ['last', 'last'], ['city', 'city'], ['street', 'street'], ['no', 'no'], ['phone', 'phone'], ['mob', 'mob']] as const;
export function copyDcToRo(v: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [a, b] of DC_TO_RO) { const src = v['dc_' + a] ?? '', dst = v['ro_' + b] ?? ''; out['ro_' + b] = dst || src; }
  return out;
}

/* ---------------- Firm list report (legacy FR_F / frList / frPdfHTML / frXlsx) ---------------- */

export const FR_F = [['all', 'Сите фирми'], ['ddv', 'ДДВ обврзници'], ['ddvM', 'ДДВ – месечно'], ['ddvQ', 'ДДВ – тромесечно'], ['noddv', 'Не се ДДВ обврзници']] as const;
export type FrFilter = (typeof FR_F)[number][0];
export const isFrFilter = (k: unknown): k is FrFilter => FR_F.some((x) => x[0] === k);

export interface FrFirm { id: string; name: string; vatRegistered: boolean; vatPeriod: string; example?: boolean }

export function frMatch(f: FrFirm, k: FrFilter): boolean {
  return k === 'all' || (k === 'ddv' && f.vatRegistered) || (k === 'ddvM' && f.vatRegistered && f.vatPeriod === 'month')
    || (k === 'ddvQ' && f.vatRegistered && f.vatPeriod !== 'month') || (k === 'noddv' && !f.vatRegistered);
}

/** Legacy `frList`: filter, drop examples unless included, sort by name (mk collation). */
export function frList<T extends FrFirm>(L: readonly T[], k: FrFilter, withExamples = true): T[] {
  return L.filter((f) => !f.example || withExamples).filter((f) => frMatch(f, k)).sort((a, b) => a.name.localeCompare(b.name, 'mk'));
}

export const frTitle = (k: FrFilter) => (k === 'ddv' || k === 'ddvM' || k === 'ddvQ' ? 'ЛИСТА НА ФИРМИ – ДДВ ОБВРЗНИЦИ' : 'ЛИСТА НА ФИРМИ');

export function frCounts(L: readonly FrFirm[]) {
  const ddv = L.filter((f) => f.vatRegistered);
  return { ddv: ddv.length, month: ddv.filter((f) => f.vatPeriod === 'month').length, quarter: ddv.filter((f) => f.vatPeriod !== 'month').length, no: L.length - ddv.length };
}

/** Legacy `frXlsx` header row. */
export const FR_XLSX_HEAD = ['Р.бр', 'Назив', 'ЕДБ', 'ЕМБС', 'Адреса', 'Град', 'ДДВ', 'Период', 'ДДВ од', 'Заклучено до'] as const;

/** Legacy `firmUnlock`: unlocking a locked year moves the lock back to 31.12 of the previous year. */
export function unlockTo(lock: string): string {
  const y = Number(String(lock).slice(0, 4));
  return `${y - 1}-12-31`;
}
