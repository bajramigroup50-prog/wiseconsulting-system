/**
 * „🏛 Институции – барања и плаќања“ — everything a state institution sends to or demands from a client firm: requests
 * (барања, барања за документи), decisions (решенија), notices and warnings (известувања, опомени), inspection minutes
 * (записници), summons, tax-control announcements — with the deadline, the amount to pay and its payment details.
 *
 * Pure: the list of institutions, the kinds and statuses, the deadline state, the payment order drafted from an item
 * (`instOrderDraft` → the existing КТД / КТБ order of `ppNal`), the bank-statement match that marks an item paid
 * (`instPaymentMatch`: amount + reference), the autopilot findings and the AI reading prompt / its normalisation.
 * Storage and services: `@wise/db` `institutions.ts`; screen `/institucii`.
 */
import { PP_BUDGET_ACC, ppNew, type PaymentOrder, type PpFirm } from '../bank/pp';
import { ppNacin } from '../bank/pp-fill';
import { newPayments } from '../bank/purpose-codes';
import { addDays, daysBetween, dmy } from './dates';

/* ---------------- institutions ---------------- */

export interface Institution { id: string; n: string; short: string; group: 'tax' | 'insp' | 'fund' | 'reg' | 'local' | 'court' | 'other' }

/** The usual institutions (the office adds its own names on the screen; an item may carry any name). */
export const INSTITUTIONS: readonly Institution[] = [
  { id: 'ujp', n: 'Управа за јавни приходи (УЈП)', short: 'УЈП', group: 'tax' },
  { id: 'ujp_ro', n: 'УЈП – Регионална дирекција', short: 'УЈП РД', group: 'tax' },
  { id: 'mf', n: 'Министерство за финансии', short: 'МФ', group: 'tax' },
  { id: 'me', n: 'Министерство за економија', short: 'МЕ', group: 'reg' },
  { id: 'dpi', n: 'Државен пазарен инспекторат', short: 'ДПИ', group: 'insp' },
  { id: 'dit', n: 'Државен инспекторат за труд', short: 'ДИТ', group: 'insp' },
  { id: 'afv', n: 'Агенција за храна и ветеринарство', short: 'АХВ', group: 'insp' },
  { id: 'dizs', n: 'Државен инспекторат за животна средина', short: 'ДИЖС', group: 'insp' },
  { id: 'fpiom', n: 'Фонд за пензиско и инвалидско осигурување (ФПИОМ)', short: 'ФПИОМ', group: 'fund' },
  { id: 'fzo', n: 'Фонд за здравствено осигурување (ФЗО)', short: 'ФЗО', group: 'fund' },
  { id: 'avrm', n: 'Агенција за вработување', short: 'АВРМ', group: 'fund' },
  { id: 'crm', n: 'Централен регистар', short: 'ЦРМ', group: 'reg' },
  { id: 'carina', n: 'Царинска управа', short: 'Царина', group: 'tax' },
  { id: 'opstina', n: 'Општина (комунални такси, данок на имот)', short: 'Општина', group: 'local' },
  { id: 'ufr', n: 'Управа за финансиско разузнавање', short: 'УФР', group: 'insp' },
  { id: 'dzs', n: 'Државен завод за статистика', short: 'ДЗС', group: 'reg' },
  { id: 'sud', n: 'Суд', short: 'Суд', group: 'court' },
  { id: 'izvrsitel', n: 'Извршител', short: 'Извршител', group: 'court' },
  { id: 'notar', n: 'Нотар', short: 'Нотар', group: 'court' },
  { id: 'other', n: 'Друга институција', short: 'Друго', group: 'other' },
];
export const INST_BY_ID: Readonly<Record<string, Institution>> = Object.fromEntries(INSTITUTIONS.map((i) => [i.id, i]));
export const isInstId = (v: unknown): v is string => typeof v === 'string' && Object.hasOwn(INST_BY_ID, v);
/** Label of an item's institution: the stored name, else the list's short name. */
export const instLabel = (i: { inst: string; instName?: string | null }) => (i.instName || INST_BY_ID[i.inst]?.short || i.inst);

/** Cyrillic-aware word regex (`\b` / `\w` know only Latin letters). */
const WB = String.raw`(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))`;
const W = (src: string) => new RegExp(src.replaceAll(String.raw`\b`, WB).replaceAll(String.raw`\w`, String.raw`\p{L}`), 'iu');
const INST_RE: readonly [RegExp, string][] = ([
  [String.raw`регионалн\w* дирекц|\bрд\s*(скопје|битола|штип|струмица|тетово|охрид|велес|куманово|прилеп)`, 'ujp_ro'],
  [String.raw`управа за јавни приходи|\bујп\b|е-даноци|e-tax`, 'ujp'],
  [String.raw`пазарен инспекторат|\bдпи\b`, 'dpi'],
  [String.raw`инспекторат за труд|\bдит\b`, 'dit'],
  [String.raw`храна и ветеринар|\bахв\b`, 'afv'],
  [String.raw`животна средина|\bдижс\b`, 'dizs'],
  [String.raw`министерство за финансии`, 'mf'],
  [String.raw`министерство за економија`, 'me'],
  [String.raw`пензиско|\bфпиом\b|\bпиом\b`, 'fpiom'],
  [String.raw`здравствено осигурување|\bфзо\b|\bфзом\b`, 'fzo'],
  [String.raw`агенција за вработување|\bаврм\b`, 'avrm'],
  [String.raw`централен регистар|\bцрм\b`, 'crm'],
  [String.raw`царин`, 'carina'],
  [String.raw`финансиско разузнавање|\bуфр\b`, 'ufr'],
  [String.raw`завод за статистика|\bдзс\b`, 'dzs'],
  [String.raw`извршител`, 'izvrsitel'],
  [String.raw`нотар`, 'notar'],
  [String.raw`\bсуд\b|основен суд|апелационен|управен суд`, 'sud'],
  [String.raw`општина|град скопје|комунал`, 'opstina'],
] as const).map(([re, id]) => [W(re), id] as [RegExp, string]);
/** The institution of a name read from a document („Управа за јавни приходи – РД Скопје“ → `ujp_ro`). */
export const instGuess = (name: string | null | undefined): string => {
  const s = String(name ?? '');
  for (const [re, id] of INST_RE) if (re.test(s)) return id;
  return 'other';
};

/* ---------------- kinds and statuses ---------------- */

export const INST_TYPES = {
  baranje: 'Барање',
  baranje_dok: 'Барање за документи / податоци',
  reshenie: 'Решение',
  zapisnik: 'Записник',
  izvestuvanje: 'Известување',
  opomena: 'Опомена',
  pokana: 'Покана',
  kontrola: 'Најава / налог за контрола',
  prekrsok: 'Прекршочен платен налог',
  izvrsuvanje: 'Извршување / блокада',
  drugo: 'Друго',
} as const;
export type InstType = keyof typeof INST_TYPES;
export const isInstType = (v: unknown): v is InstType => typeof v === 'string' && Object.hasOwn(INST_TYPES, v);

export const INST_STATUS = { new: 'Ново', work: 'Во работа', answered: 'Одговорено', paid: 'Платено', closed: 'Затворено' } as const;
export type InstStatus = keyof typeof INST_STATUS;
export const isInstStatus = (v: unknown): v is InstStatus => typeof v === 'string' && Object.hasOwn(INST_STATUS, v);
/** An item still needs the office (its deadline counts). */
export const instOpen = (s: string) => s === 'new' || s === 'work';

export const INST_SOURCES = { manual: 'рачно', upload: 'скен / PDF', incoming: 'Пристигнати документи', mail: 'е-пошта' } as const;
export type InstSource = keyof typeof INST_SOURCES;

/* ---------------- deadlines ---------------- */

export type InstDueState = 'late' | 'today' | 'soon' | 'ok' | 'none' | 'done';
/** „soon“ = within this many days (the reminders and the autopilot use the same window). */
export const INST_SOON_DAYS = 7;

export interface InstLike { status: string; due?: string | null; amount?: number | string | null; paidOn?: string | null }

/** Deadline state of an item on `today`; a paid item whose answer is still open keeps counting. */
export function instDueState(i: InstLike, today: string): InstDueState {
  if (!instOpen(i.status)) return 'done';
  if (!i.due) return 'none';
  const d = daysBetween(today, i.due);
  return d < 0 ? 'late' : d === 0 ? 'today' : d <= INST_SOON_DAYS ? 'soon' : 'ok';
}
export const INST_DUE_LBL: Record<InstDueState, string> = { late: 'задоцнето', today: 'денес', soon: 'наскоро', ok: 'во рок', none: 'без рок', done: '' };
export const INST_DUE_CLS: Record<InstDueState, string> = { late: 'bad', today: 'bad', soon: 'warn', ok: 'good', none: 'info', done: '' };
/** „за 3 дена“ / „пред 2 дена“ / „денес“. */
export function instDueText(due: string | null | undefined, today: string): string {
  if (!due) return '';
  const d = daysBetween(today, due);
  return d === 0 ? 'денес' : d > 0 ? `за ${d} ${d === 1 ? 'ден' : 'дена'}` : `пред ${-d} ${d === -1 ? 'ден' : 'дена'}`;
}
/** Deadline from „во рок од N дена од приемот“. */
export const instDueFromDays = (received: string | null | undefined, days: number | null | undefined): string | null =>
  received && /^\d{4}-\d{2}-\d{2}$/.test(received) && days && days > 0 && days < 400 ? addDays(received, Math.round(days)) : null;

/* ---------------- payment ---------------- */

const dig = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const num = (v: unknown): number => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
/** 15-digit account of an IBAN (MK07 + 15) or of an account typed with dashes. */
export const instAcc = (s: unknown): string => { const d = dig(s); return d.length === 17 && /^mk/i.test(String(s ?? '').trim()) ? d.slice(2) : d; };

export interface InstPay {
  amount?: number | string | null; payRecip?: string | null; payAccount?: string | null; payUplSm?: string | null; payPrihod?: string | null; payRef?: string | null; payPurpose?: string | null;
}
/** Paid to the Budget (КТБ): a revenue code / payment account, or the treasury account itself. */
export const instPublicRevenue = (p: InstPay): boolean => !!(dig(p.payPrihod) || dig(p.payUplSm)) || instAcc(p.payAccount) === PP_BUDGET_ACC;

export interface InstOrderItem extends InstPay { id: string; inst: string; instName?: string | null; type: string; refNo?: string | null; subject?: string | null }

/** The payment order of an item (КТБ to the Budget, else КТД to the institution's account). */
export function instOrderDraft(i: InstOrderItem, payer: PpFirm, today: string): PaymentOrder {
  const amount = num(i.amount) > 0 ? Math.round(num(i.amount) * 100) / 100 : null;
  const what = `${INST_TYPES[i.type as InstType] ?? 'Обврска'}${i.refNo ? ' бр. ' + i.refNo : ''} – ${instLabel(i)}`;
  const purpose = (i.payPurpose || `Плаќање по ${what}`).slice(0, 140);
  if (instPublicRevenue(i)) {
    return ppNew('pp50', today, payer, { purpose, amount, uplSm: i.payUplSm ?? '', prihod: i.payPrihod ?? '', refDebit: i.payRef ?? '', ...(i.payRecip ? { recip: i.payRecip } : {}) });
  }
  const recipAcc = instAcc(i.payAccount);
  return ppNew('pp30', today, payer, {
    recip: i.payRecip || i.instName || INST_BY_ID[i.inst]?.n || '', recipAcc, purpose, amount, refCredit: i.payRef ?? '', refDebit: '',
    code: newPayments(today) ? 'GOVT' : '930', nacin: ppNacin(payer.account, recipAcc),
  });
}
/** `payment_orders.ref_id` of the order made from an item. */
export const instOrderRef = (id: string) => `inst:${id}`;

/** One outgoing bank-statement line as the match reads it (`amount` signed, − = paid out). */
export interface InstBankLine {
  id: string; date: string; amount: number; payRef?: string | null; description?: string | null; purpose?: string | null; bref?: string | null; name?: string | null;
  counterAccount?: string | null; statementNo?: string | null;
}
export interface InstMatchItem extends InstPay { id: string; received?: string | null; status: string }

/**
 * The statement line that pays the item: an outgoing line of the same amount (± 1 den.), not before the item was
 * received (3 days of slack for a back-dated entry), AND the reference — the „повикување на број“ (its digits, at least
 * 4) in the line's reference / description; without a reference on the item, the recipient account must match (a
 * treasury payment without a reference is never matched: every tax goes to the same account). Closest date wins.
 */
export function instPaymentMatch(i: InstMatchItem, lines: readonly InstBankLine[], taken: ReadonlySet<string> = new Set()): InstBankLine | null {
  const amt = num(i.amount);
  if (!(amt > 0)) return null;
  const ref = dig(i.payRef);
  const acc = instAcc(i.payAccount);
  const from = i.received ? addDays(i.received, -3) : '';
  const C = lines.filter((l) => !taken.has(l.id) && l.amount < 0 && Math.abs(Math.abs(l.amount) - amt) <= 1 && (!from || l.date >= from)).filter((l) => {
    if (ref.length >= 4) return [l.payRef, l.description, l.purpose, l.bref].some((x) => dig(x).includes(ref));
    return !!acc && acc !== PP_BUDGET_ACC && instAcc(l.counterAccount) === acc;
  });
  return C.sort((a, b) => Math.abs(daysBetween(i.received ?? a.date, a.date)) - Math.abs(daysBetween(i.received ?? b.date, b.date)))[0] ?? null;
}
const fmt2 = (n: number) => Math.abs(n).toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** „✓ платено (извод бр. 12 од 05.11.2026, 3.000,00 ден.)“ */
export const instPaidNote = (l: InstBankLine) => `✓ платено (извод${l.statementNo ? ' бр. ' + l.statementNo : ''} од ${dmy(l.date)}, ${fmt2(l.amount)} ден.)`;

/* ---------------- autopilot / reminders ---------------- */

export interface InstFindItem extends InstLike { id: string; inst: string; instName?: string | null; type: string; refNo?: string | null; subject?: string | null }
/** One line of text for an item: „УЈП · Решение бр. 12-345 – доплата ДДВ“. */
export const instTitle = (i: Pick<InstFindItem, 'inst' | 'instName' | 'type' | 'refNo' | 'subject'>): string =>
  `${instLabel(i)} · ${INST_TYPES[i.type as InstType] ?? i.type}${i.refNo ? ' бр. ' + i.refNo : ''}${i.subject ? ' – ' + i.subject : ''}`.slice(0, 200);

/** The autopilot (Известувања) lines of a firm: overdue → итно, due within 7 days → внимание, unpaid amount past its deadline. */
export function instFindings(I: readonly InstFindItem[], today: string): { lvl: 'bad' | 'warn'; txt: string }[] {
  const out: { lvl: 'bad' | 'warn'; txt: string }[] = [];
  for (const i of I) {
    const s = instDueState(i, today);
    const pay = num(i.amount) > 0 && !i.paidOn ? `, за плаќање ${fmt2(num(i.amount))} ден.` : '';
    if (s === 'late' || s === 'today') out.push({ lvl: 'bad', txt: `${instTitle(i)}: рокот ${s === 'today' ? 'истекува денес' : 'истече на ' + dmy(i.due)}${pay}` });
    else if (s === 'soon') out.push({ lvl: 'warn', txt: `${instTitle(i)}: рок ${dmy(i.due)} (${instDueText(i.due, today)})${pay}` });
  }
  return out;
}

/* ---------------- AI reading ---------------- */

export const INST_PROMPT = `You read an official document that a state institution of North Macedonia sent to a company (a request, decision, notice, warning, inspection minutes, summons, tax-control order, misdemeanour payment order, enforcement…). Documents are in Macedonian (sometimes Albanian).
Return ONLY a JSON object, no prose:
{
  "institution": "full name of the issuing institution as written, e.g. Управа за јавни приходи – Регионална дирекција Скопје",
  "type": one of "baranje" (request), "baranje_dok" (request for documents/data), "reshenie" (decision), "zapisnik" (minutes / record), "izvestuvanje" (notice), "opomena" (warning / reminder to pay), "pokana" (summons / invitation), "kontrola" (announcement or order of a control/inspection), "prekrsok" (misdemeanour payment order / fine), "izvrsuvanje" (enforcement, account blocking), "drugo",
  "refNo": "the document's number (број / арх. бр.)",
  "date": "YYYY-MM-DD date of the document",
  "due": "YYYY-MM-DD deadline to answer / pay / act, if a date is written, else null",
  "dueDays": number of days of the deadline if written as „во рок од N дена“ (from the receipt), else null,
  "subject": "what is demanded, max 160 characters, in Macedonian",
  "amount": total amount to pay in denars as a number (principal + interest + costs when a total is given), else null,
  "recipient": "payee name for the payment, else null",
  "account": "payee account (трансакциска сметка / IBAN), else null",
  "uplSm": "уплатна сметка (e.g. 840-XXX-02687), else null",
  "prihod": "приходна шифра и програма (e.g. 714116 00), else null",
  "payRef": "повикување на број (reference for the payment), else null",
  "firmName": "the company the document is addressed to",
  "firmEdb": "its ЕДБ (tax number) if written, else null"
}
Never invent values: use null when something is not in the document.`;

export interface InstRead {
  inst: string; instName: string | null; type: InstType; refNo: string | null; date: string | null; due: string | null; dueDays: number | null; subject: string | null;
  amount: number | null; payRecip: string | null; payAccount: string | null; payUplSm: string | null; payPrihod: string | null; payRef: string | null;
  firmName: string | null; firmEdb: string | null;
}
const S = (v: unknown, n = 200): string | null => { const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''; return s && !/^(null|n\/a|-)$/i.test(s) ? s.slice(0, n) : null; };
const D = (v: unknown): string | null => { const s = S(v, 20); if (!s) return null; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s); return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null; };

/** The model's JSON → the item fields (anything unknown is null; the deadline from „во рок од N дена“ when no date). */
export function instFromRead(r: unknown, received?: string | null): InstRead {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const instName = S(o.institution);
  const amount = num(o.amount);
  const dueDays = Number.isFinite(Number(o.dueDays)) && Number(o.dueDays) > 0 ? Math.round(Number(o.dueDays)) : null;
  return {
    inst: instGuess(instName), instName, type: isInstType(o.type) ? o.type : 'drugo', refNo: S(o.refNo, 80), date: D(o.date),
    due: D(o.due) ?? instDueFromDays(received ?? D(o.date), dueDays), dueDays, subject: S(o.subject, 300),
    amount: amount > 0 ? Math.round(amount * 100) / 100 : null, payRecip: S(o.recipient), payAccount: S(o.account, 40), payUplSm: S(o.uplSm, 40), payPrihod: S(o.prihod, 40),
    payRef: S(o.payRef, 80), firmName: S(o.firmName), firmEdb: S(o.firmEdb, 20),
  };
}

/* ---------------- reading without AI (text PDF / Word / TXT) ---------------- */

const AMT = String.raw`(\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const amtOf = (s: string): number => {
  const t = s.replace(/\s/g, '');
  const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : /\.\d{3}(\.|$)/.test(t) ? Number(t.replace(/\./g, '')) : Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const dateOf = (s: string | undefined): string | null => { const m = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/.exec(s ?? ''); return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null; };
const TYPE_RE: readonly [RegExp, InstType][] = ([
  [String.raw`прекршочен платен налог`, 'prekrsok'], [String.raw`барање за (доставување|достава) (на )?(документ|податоц|докази)`, 'baranje_dok'], [String.raw`\bр\s*е\s*ш\s*е\s*н\s*и\s*е\b`, 'reshenie'],
  [String.raw`\bзаписник\b`, 'zapisnik'], [String.raw`\bопомена\b`, 'opomena'], [String.raw`налог за (даночна )?контрола|најава за (даночна )?контрола|известување за контрола`, 'kontrola'],
  [String.raw`\bпокана\b`, 'pokana'], [String.raw`извршување|блокада на сметка|присилна наплата`, 'izvrsuvanje'], [String.raw`\bизвестување\b`, 'izvestuvanje'], [String.raw`\bбарање\b`, 'baranje'],
] as const).map(([re, t]) => [W(re), t] as [RegExp, InstType]);

/**
 * The fields of an institution's document from its text, in the shape of the AI answer (`INST_PROMPT`): the
 * institution from its name, the kind from the title, „Број:“, the first date, „во рок од N дена“ / „до ДД.ММ.ГГГГ“,
 * „вкупно / износ … ден.“, „уплатна сметка“, „приходна шифра“, „повикување на број“, „ЕДБ“. Null when nothing is found.
 */
export function instFromText(text: string): Record<string, unknown> | null {
  const T = text.replace(/ /g, ' ');
  const head = T.slice(0, 1500);
  // the institution's name may run over two lines („Управа за јавни приходи“ / „Регионална дирекција Скопје“)
  const HL = head.split(/\n/).map((l) => l.trim());
  const k = HL.findIndex((l) => instGuess(l) !== 'other');
  const instLine = k < 0 ? null : HL[k + 1] && instGuess(HL[k + 1]) !== 'other' ? `${HL[k]} – ${HL[k + 1]}` : HL[k]!;
  const type = TYPE_RE.find(([re]) => re.test(head))?.[1] ?? null;
  const refNo = /(?:број|бр\.|арх\.?\s*бр\.?)\s*[:.]?\s*([0-9][0-9A-Za-zА-Ша-ш/.\-]{1,40})/i.exec(head)?.[1]?.replace(/[.,]$/, '') ?? null;
  const date = dateOf(/(?:датум|скопје|од)\s*[:,]?\s*(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/i.exec(head)?.[1]) ?? dateOf(head);
  const dueDays = Number(/во\s+рок\s+од\s+(\d{1,3})\s*\(?[^)]*\)?\s*(?:работни\s+)?дена/i.exec(T)?.[1]) || null;
  const due = dateOf(/(?:најдоцна\s+)?до\s+(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})\s*(?:година|год\.)?/i.exec(T)?.[1]);
  const am = new RegExp(String.raw`(?:вкупно|вкупен\s+износ|износ(?:\s+од)?|во\s+износ\s+од|да\s+плати)\s*[:]?\s*` + AMT + String.raw`\s*(?:денари|ден\.?|мкд)`, 'i').exec(T);
  const amount = am ? amtOf(am[1]!) : null;
  const uplSm = /уплатна\s+сметка\s*[:]?\s*(\d{3}[-\s]?\d{3}[-\s]?\d{5})/i.exec(T)?.[1] ?? null;
  const prihod = W(String.raw`приходн\w*\s+шифр\w*(?:\s+и\s+програма)?\s*[:]?\s*(\d{6}(?:\s?\d{2})?)`).exec(T)?.[1] ?? null;
  const payRef = /повик(?:ување)?\s+на\s+број(?:\s+задолжување)?\s*[:]?\s*([0-9A-Za-z\-/]{4,40})/i.exec(T)?.[1] ?? null;
  const account = /(?:трансакциска|жиро)\s+сметка\s*(?:бр\.?)?\s*[:]?\s*((?:MK|МК)\s?07\s?)?(\d{3}[-\s]?\d{10}[-\s]?\d{2}|\d{15})/i.exec(T);
  const firmEdb = /ЕДБ\s*[:]?\s*((?:MK|МК)?\s?\d{13})/i.exec(T)?.[1]?.replace(/\D/g, '') ?? null;
  const out = {
    institution: instLine, type, refNo, date, due, dueDays, subject: null, amount: amount && amount > 0 ? amount : null, recipient: null,
    account: account ? account[2]!.replace(/\D/g, '') : null, uplSm, prihod, payRef, firmName: null, firmEdb, noai: true,
  };
  return [instLine, type, refNo, due, dueDays, amount, uplSm, prihod, payRef].some((x) => x) ? out : null;
}
