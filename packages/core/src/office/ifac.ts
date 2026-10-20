/**
 * IFAC standards of the office per client firm (ИСОС – the Institute of Certified Auditors and Accountants of North
 * Macedonia requires its members to apply them):
 *  - ISRS 4410 (Revised) – the engagement letter („Писмо за ангажман“) for the year: scope, the applicable financial
 *    reporting framework, the responsibilities of both sides, the compilation report, fees, deadlines, signatures;
 *  - ISQM 1 – the quality checklist per engagement (firm × year): acceptance and continuance (client integrity, the
 *    ЗСППФТ / УФР analysis, risk, competence, independence and the IESBA declarations) and, before the year is
 *    closed, the review of the final accounts by a second person (who and when);
 *  - IESBA Code of Ethics – a short yearly declaration of every employee (the five fundamental principles,
 *    independence, confidentiality), recorded in the ISO „Обуки“ register.
 *
 * Pure – storage in @wise/db `ifac_records` (one row per kind × year × firm / user), the letter's PDF in the dossier.
 */
import { KD_SVC, kdAmt, kdDocFoot, kdDocHead, kdVat, kdWords, type KdFirm, type KdOffice } from '../firms/kdog';
import { hrDocCode } from '../payroll/hr';

export type IfacKind = 'letter' | 'qc' | 'ethics' | 'staff' | `sqm_${string}` | `isos_${string}`;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dmy = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');
const fmt = (n: number) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

/* ================= ISRS 4410 – engagement letter ================= */

/** Dossier category of the letter (shown with its validity → the dossier's expiry warning). */
export const EL_DOS_CAT = 'Писмо за ангажман (ISRS 4410)';

/** The applicable financial reporting framework (ISRS 4410 §24(a)(ii), §25). */
export const EL_FRAMEWORKS = [
  ['mk', 'Законот за трговските друштва и Правилникот за водење сметководство, со Меѓународните сметководствени стандарди објавени во „Службен весник“'],
  ['sme', 'Меѓународниот стандард за финансиско известување за мали и средни ентитети (МСФИ за МСЕ)'],
  ['micro', 'Правилникот за сметководство за микро и мали трговци (поедноставено финансиско известување)'],
  ['npo', 'Законот за сметководство за непрофитните организации и прописите донесени врз основа на него'],
] as const;
export type ElFramework = (typeof EL_FRAMEWORKS)[number][0];

/** The four services of the letter that the ISRS 4410 engagement is about (others from the contract may be added). */
export const EL_SVC_DEF = ['book', 'pay', 'vat', 'year'];

export interface ElSig { at: string; by?: string; name?: string; scan?: string | null }

/** One letter per firm and financial year. Amounts as entered (`feeMode`). */
export interface ElLetter {
  number: string; date: string; year: number; place: string;
  svc: string[]; framework: ElFramework; rep: string; repRole: string;
  feeMode: 'gross' | 'net'; fee: number | string; feeYear: number | string; feeHour: number | string;
  docDay: number; payDay: number; contractNo: string; note: string;
  /** The client's signature (date and signatory) – from the signed paper copy or on the screen. */
  signed?: ElSig | null;
  /** `dossier_docs.id` of the copy in the dossier. */
  dossierId?: string | null;
}

/** The contract data a letter takes over (`firms.settings.kdog` summary + the contract itself). */
export interface ElContract { number?: string; feeMode?: 'gross' | 'net'; fee?: number | string; feeYear?: number | string; feeHour?: number | string; docDay?: number; payDay?: number; svc?: string[]; rep?: string; repRole?: string }

/** `ПА-001/2026`. */
export const elNumber = (n: number, year: number | string) => `ПА-${String(n).padStart(3, '0')}/${year}`;

/** A new letter for the year, from the office defaults, the firm and its contract. */
export function elNew(O: KdOffice, f: KdFirm & { signer?: string | null; rep?: string | null }, year: number, today: string, k?: ElContract | null, framework: ElFramework = 'mk'): ElLetter {
  const svc = k?.svc?.length ? k.svc.filter((s) => KD_SVC.some((x) => x[0] === s)) : [...EL_SVC_DEF];
  return {
    number: '', date: today, year, place: O.city || f.city || '', svc, framework,
    rep: k?.rep || f.signer || f.rep || f.manager || '', repRole: k?.repRole || 'Управител',
    feeMode: k?.feeMode || O.feeMode || 'gross', fee: k?.fee ?? O.fee ?? '', feeYear: k?.feeYear ?? O.feeYear ?? '', feeHour: k?.feeHour ?? O.feeHour ?? '',
    docDay: Number(k?.docDay) || Number(O.docDay) || 5, payDay: Number(k?.payDay) || 10, contractNo: k?.number ?? '', note: '',
  };
}

/** Normalise a stored / posted letter. */
export function elNormalize(v: Partial<ElLetter> & Record<string, unknown>, today: string): ElLetter {
  const num = (x: unknown, def: number) => { const q = Math.round(Number(x)); return Number.isFinite(q) && q > 0 ? q : def; };
  const amt = (x: unknown) => { const q = Number(String(x ?? '').replace(',', '.')); return Number.isFinite(q) && q > 0 ? Math.round(q * 100) / 100 : ''; };
  const y = Math.round(Number(v.year));
  const fw = EL_FRAMEWORKS.find((x) => x[0] === v.framework)?.[0] ?? 'mk';
  const sg = v.signed && typeof v.signed === 'object' && isDate(String((v.signed as ElSig).at ?? '').slice(0, 10)) ? (v.signed as ElSig) : null;
  return {
    number: String(v.number ?? ''), date: isDate(v.date) ? v.date : today, year: y > 2000 && y < 2100 ? y : Number(today.slice(0, 4)),
    place: String(v.place ?? ''), framework: fw, rep: String(v.rep ?? ''), repRole: String(v.repRole ?? ''),
    svc: Array.isArray(v.svc) ? v.svc.filter((s): s is string => typeof s === 'string' && KD_SVC.some((x) => x[0] === s)) : [...EL_SVC_DEF],
    feeMode: v.feeMode === 'net' ? 'net' : 'gross', fee: amt(v.fee), feeYear: amt(v.feeYear), feeHour: amt(v.feeHour),
    docDay: Math.min(28, num(v.docDay, 5)), payDay: Math.min(28, num(v.payDay, 10)), contractNo: String(v.contractNo ?? ''), note: String(v.note ?? ''),
    signed: sg, dossierId: typeof v.dossierId === 'string' ? v.dossierId : null,
  };
}

/** The letter covers the financial year: valid to 31.12; renewed for the next year (reminder 30 days before). */
export const elValidTo = (l: Pick<ElLetter, 'year'>) => `${l.year}-12-31`;
export const EL_RENEW_DAYS = 30;
export const elRenewTitle = (year: number) => `Обнова на писмото за ангажман (ISRS 4410) за ${year + 1}`;

/** Status of the letter: [label, pill class]. */
export function elStatus(l: Pick<ElLetter, 'signed' | 'number'> | null | undefined): [string, string] {
  return !l ? ['нема писмо', 'bad'] : l.signed ? ['потпишано', 'good'] : ['чека потпис', 'warn'];
}

/** The deadlines of the engagement by scope (agreed in the letter – ISRS 4410 A24, the legal ones in MK). */
export function elDeadlines(l: Pick<ElLetter, 'svc' | 'docDay' | 'year'>): [string, string][] {
  const has = (s: string) => l.svc.includes(s);
  const D: [string, string][] = [['Доставување на исправите за претходниот месец (клиент)', `до ${l.docDay}-ти во месецот`]];
  if (has('book') || has('cash')) D.push(['Книжење на исправите, изводите и благајната', 'до крајот на месецот по доставувањето']);
  if (has('vat')) D.push(['ДДВ пријава и книги за ДДВ (УЈП)', 'до 25-ти во месецот по даночниот период']);
  if (has('pay')) D.push(['Пресметка на плата и МПИН (УЈП / Фонд)', 'пред исплатата, најдоцна до 15-ти во месецот за претходниот']);
  if (has('stock')) D.push(['Материјално книговодство и КДФИ', 'месечно, со книжењето']);
  if (has('year')) {
    D.push(['Пописна листа и усогласување со комитентите (клиент)', `до 31.01.${l.year + 1}`]);
    D.push(['Годишна сметка (ЦРМ) и даночен биланс (УЈП)', `до 15.03.${l.year + 1}`]);
  }
  return D;
}

export interface ElHtmlCtx {
  firm: KdFirm; firmId: string; O: KdOffice;
  /** The office firm (memo: logo, phone, e-mail, bank). */
  off?: KdFirm | null;
  /** Number shown on a draft without one. */
  peekNo?: string;
  img: (fileId: string) => string;
  draftMark?: boolean;
}

/** Control code over the letter's essential content. */
export const elCode = (l: Partial<ElLetter>, firmId: string): string =>
  hrDocCode({ t: 'el', no: l.number, f: firmId, y: l.year, svc: l.svc, fw: l.framework, fee: l.fee, d: l.date });

const DRAFT_MARK = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0"><div style="transform:rotate(-30deg);font-size:90px;font-weight:800;color:rgba(180,35,24,.10);letter-spacing:10px;font-family:Arial">НАЦРТ</div></div>';

/** The engagement letter as HTML (screen, print, the PDF in the dossier) – ISRS 4410 (Revised) §24 contents. */
export function elHtml(l: ElLetter, x: ElHtmlCtx): string {
  const f = x.firm, O = x.O;
  const b = (v: unknown) => (v ? esc(v) : '____________________');
  const n = (v: unknown) => (Number(v) ? fmt(Number(v)) : '________');
  const r = kdVat(O);
  const one = (v: unknown) => { const q = kdAmt(l.feeMode, v as number, r); return r ? `${n(q.net)} денари без ДДВ (${n(q.gross)} денари со ДДВ)` : `${n(q.net)} денари`; };
  const A = kdAmt(l.feeMode, l.fee, r);
  const S = KD_SVC.filter((s) => l.svc.includes(s[0]));
  const fw = EL_FRAMEWORKS.find((q) => q[0] === l.framework)?.[1] ?? EL_FRAMEWORKS[0][1];
  const year = l.year;
  const compile = l.svc.includes('year');
  let sec = 0;
  const h = (t: string) => { sec++; return `<p style="margin:12px 0 4px"><b>${sec}. ${esc(t)}</b></p>`; };
  const p = (t: string) => `<p style="margin:0 0 6px;text-align:justify">${t}</p>`;
  const ul = (L: string[]) => `<ol style="margin:0 0 6px 18px;padding:0">${L.map((t) => `<li style="margin:0 0 2px;text-align:justify">${t}</li>`).join('')}</ol>`;
  const sigBox = (who: string, firmName: string | null | undefined, name: string | undefined, role: string | undefined, at: string | null | undefined) =>
    `<div style="text-align:left;min-width:72mm"><b>${who}</b><br>${esc(firmName || '')}<div style="margin-top:26px;border-top:1px solid #111;padding-top:3px">${esc(name || '')}${role ? ', ' + esc(role) : ''}<br><small>(име, презиме и потпис)</small></div><div style="margin-top:14px">Датум: ${at ? esc(dmy(at)) : '_______________'}</div></div>`;
  const D = elDeadlines(l);
  const H = `<div style="font-family:'Times New Roman',Georgia,serif;font-size:12px;line-height:1.5;color:#111">
  <p style="margin:0">До: <b>${b(f.name)}</b>, ${b([f.address, f.city].filter(Boolean).join(', '))}, ЕДБ ${b(f.edb)}<br>н.р. ${b(l.rep)} – ${b(l.repRole)}</p>
  <p style="margin:6px 0 0;text-align:right">${b(l.place)}, ${l.date ? dmy(l.date) : '__________'} година</p>
  <h1 style="text-align:center;font-family:'Times New Roman',serif;font-size:17px;margin:12px 0 2px">ПИСМО ЗА АНГАЖМАН</h1>
  <p style="text-align:center;margin:0">за сметководствени услуги${compile ? ' и составување на финансиските извештаи' : ''} за ${year} година</p>
  <p style="text-align:center;margin:0 0 10px">бр. ${l.number ? esc(l.number) : x.peekNo ? esc(x.peekNo) : b('')} · ISRS 4410 (ревидиран) на IFAC${l.contractNo ? ` · кон Договорот бр. ${esc(l.contractNo)}` : ''}</p>
  ${p(`Почитувани, со ова писмо ги потврдуваме условите на ангажманот на <b>${b(O.name)}</b> (во понатамошниот текст: „ние“) за <b>${b(f.name)}</b> (во понатамошниот текст: „Друштвото“) за финансиската ${year} година, согласно Меѓународниот стандард за сродни услуги ISRS 4410 (ревидиран) „Ангажмани за составување“ и Кодексот на етика за професионални сметководители на IESBA, што ги применуваме како членка на ИСОС.`)}
  ${h('Цел и опфат на ангажманот')}
  ${p('Ќе ги вршиме следните услуги:')}
  ${ul([...S.map((s) => esc(s[1])), ...(l.note ? [esc(l.note)] : [])])}
  ${compile ? p(`Целта на ангажманот за составување е да Ви помогнеме во изготвувањето и презентирањето на годишните финансиски извештаи на Друштвото за ${year} година (биланс на состојба, биланс на успех и објаснувачки белешки) во согласност со применливата рамка, врз основа на информациите што ги дава раководството.`) : ''}
  ${p('<b>Ангажманот не е ревизија, ниту преглед (ангажман за уверување).</b> Затоа нема да изразиме ревизорско мислење ниту заклучок за уверување за финансиските извештаи и нема да ги проверуваме точноста и целосноста на информациите што ни ги давате. Ангажманот не може да се смета за откривање измами, грешки или незаконски дела; доколку при работата дознаеме за нив, ќе Ве известиме.')}
  ${h('Применлива рамка за финансиско известување')}
  ${p(`Финансиските извештаи се составуваат според ${esc(fw)}, за општа намена – за Централниот регистар, Управата за јавни приходи, сопствениците и другите корисници.`)}
  ${h('Наши одговорности')}
  ${ul([
    'Услугите ги вршиме стручно и со должно внимание, во законските рокови, врз основа на исправите и информациите што ги доставувате.',
    'Ги почитуваме основните начела на Кодексот на IESBA: интегритет, објективност, професионална компетентност и должно внимание, доверливост и професионално однесување.',
    'Квалитетот на работата го управуваме според ISQM 1: проверка пред прифаќање на ангажманот и преглед на годишната сметка од второ лице пред поднесување.',
    'Сите податоци на Друштвото ги чуваме како деловна тајна, и по престанокот на соработката; личните податоци ги обработуваме согласно Законот за заштита на личните податоци.',
    'Согласно Законот за спречување перење пари и финансирање тероризам (ЗСППФТ) сме должни да спроведеме анализа на клиентот, да ги утврдиме вистинските сопственици и да ги пријавиме сомнителните трансакции до Управата за финансиско разузнавање (УФР).',
  ])}
  ${h('Одговорности на раководството на Друштвото')}
  ${p('Ангажманот се врши врз основа на тоа дека раководството ги прифаќа и ги разбира своите одговорности за:')}
  ${ul([
    'финансиските извештаи и нивното составување и презентирање според применливата рамка, како и за изборот на рамката;',
    'внатрешните контроли што ги смета за потребни за финансиските извештаи да немаат материјално погрешни прикажувања поради измама или грешка;',
    'точноста, целосноста и веродостојноста на евиденциите, исправите, објаснувањата и другите информации што ни ги дава;',
    `навремено доставување на сите исправи за претходниот месец најдоцна до <b>${esc(l.docDay)}-ти</b> во месецот и пристап до сите информации и лица потребни за ангажманот;`,
    'проценките и одлуките (пописи, вредносни усогласувања, резервирања) потребни за составувањето.',
  ])}
  ${compile ? p('Пред поднесувањето на годишната сметка раководството писмено ја потврдува одговорноста за конечната верзија на финансиските извештаи.') : ''}
  ${compile ? `${h('Извештај за составување')}${p(`За годишните финансиски извештаи за ${year} година ќе издадеме Извештај за составување согласно ISRS 4410 (ревидиран). Во него ќе наведеме дека извештаите ги составивме врз основа на информациите од раководството, дека не извршивме ревизија ни преглед и дека не изразуваме мислење ни заклучок за уверување. Ако во текот на ангажманот ги измените условите или рамката, извештајот ќе го прилагодиме.`)}` : ''}
  ${h('Рокови')}
  <table style="width:100%;border-collapse:collapse;margin:0 0 6px;font-size:11.5px">${D.map(([a, c]) => `<tr><td style="border:1px solid #999;padding:2px 6px">${esc(a)}</td><td style="border:1px solid #999;padding:2px 6px;white-space:nowrap">${esc(c)}</td></tr>`).join('')}</table>
  ${p('Не одговараме за последиците (казни, камати, пропуштени рокови) настанати поради недоставени, задоцнети или нецелосни исправи и информации.')}
  ${h('Надоместок')}
  ${p(`Месечниот надоместок изнесува ${!Number(l.fee) ? `<b>________</b> денари${r ? ' без ДДВ' : ''}` : r ? `<b>${n(A.net)}</b> денари (${esc(kdWords(A.net))}) без ДДВ, односно <b>${n(A.gross)}</b> денари со ДДВ` : `<b>${n(A.net)}</b> денари (${esc(kdWords(A.net))})`}${Number(l.feeYear) ? `; за годишната сметка и даночниот биланс еднократно ${one(l.feeYear)}` : ''}${Number(l.feeHour) ? `; услугите надвор од опфатот се наплаќаат по ${one(l.feeHour)} за час` : ''}. Надоместокот се плаќа по фактура до <b>${esc(l.payDay)}-ти</b> во месецот за претходниот месец${l.contractNo ? `, според Договорот за сметководствени услуги бр. ${esc(l.contractNo)}` : ''}.`)}
  ${h('Важност и обнова')}
  ${p(`Писмото важи за финансиската ${year} година, до 31.12.${year}, и се обновува за секоја следна година или порано, кога ќе се променат условите, опфатот или рамката. Писмото го дополнува Договорот за сметководствени услуги; при разлика, за прашањата уредени со Договорот важи Договорот.`)}
  ${p('Ве молиме потпишете го и вратете ни го еден примерок од писмото, како потврда дека ги разбирате и ги прифаќате условите на ангажманот.')}
  <div class="sigrow" style="page-break-inside:avoid;break-inside:avoid;display:flex;justify-content:space-between;margin-top:26px;gap:30px">${sigBox('За сметководителот', O.name, O.rep, O.repRole || 'Управител', l.date)}${sigBox('Потврдено и прифатено од Друштвото', f.name, l.signed?.name || l.rep, l.repRole, l.signed?.at)}</div>
  ${l.signed ? `<p style="font-size:8.5pt;color:#555;margin-top:12px">Потпишано од Друштвото: ${esc(dmy(l.signed.at))}${l.signed.by ? ' (' + esc(l.signed.by) + ')' : ''}</p>` : ''}</div>`;
  const of = x.off ?? {};
  const memo: KdFirm = { ...of, name: O.name || of.name, address: O.address || of.address, city: O.city || of.city, edb: O.edb || of.edb, embs: O.embs || of.embs, bank: O.bank || of.bank, phone: O.phone || of.phone, email: O.email || of.email };
  const logo = O.logo || of.logo;
  const code = elCode(l, x.firmId);
  const inner = kdDocHead(memo, { conf: true, code, logoSrc: logo ? x.img(logo) : null }) + H + kdDocFoot(code, `Писмо за ангажман ${l.number ? 'бр. ' + l.number + ' ' : ''}за ${year}.`);
  return !l.signed && x.draftMark ? `<div style="position:relative">${DRAFT_MARK}<div style="position:relative">${inner}</div></div>` : `<div>${inner}</div>`;
}

/* ================= ISQM 1 – quality checklist per engagement ================= */

export interface QcItem { k: string; n: string; auto?: boolean }

/** Acceptance and continuance (ISQM 1 §30(c), §34(e); IESBA 300, 320, part 4B). `auto` = read from the system. */
export const QC_ACCEPT: readonly QcItem[] = [
  { k: 'integrity', n: 'Интегритет на клиентот – сопственици, управител, углед, претходни спорови или казни' },
  { k: 'aml', n: 'УФР / ЗСППФТ – анализа на клиентот (вистински сопственик, PEP, ризик) направена и важечка', auto: true },
  { k: 'risk', n: 'Ризик на ангажманот проценет (сложеност, готовина, рокови, промена на сметководител)', auto: true },
  { k: 'competence', n: 'Канцеларијата има компетентност, време и луѓе за ангажманот (дејност, обем, рокови)' },
  { k: 'independence', n: 'Независност и судир на интереси – нема финансиски интерес, семејни врски, самопроверка или застапување' },
  { k: 'ethics', n: 'Изјавите за етика (IESBA) за годината се потпишани од сите вработени', auto: true },
  { k: 'contract', n: 'Договор за сметководствени услуги – потпишан', auto: true },
  { k: 'letter', n: 'Писмо за ангажман (ISRS 4410) за годината – потпишано од клиентот', auto: true },
];

/** The review of the final accounts by a second person before the year is closed (ISQM 1 §31(b), §34(f); ISRS 4410 §37–39). */
export const QC_REVIEW: readonly QcItem[] = [
  { k: 'tb', n: 'Бруто билансот и салдата се проверени (логика по класи, негативни салда, нераспоредени конта)' },
  { k: 'rec', n: 'Банка, благајна и комитенти (ИОС) се усогласени; пописот е книжен' },
  { k: 'tax', n: 'Даночниот биланс и годишниот ДДВ се проверени' },
  { k: 'notes', n: 'Објаснувачките белешки се целосни и се совпаѓаат со билансите' },
  { k: 'py', n: 'Споредба со претходната година – значајните промени се објаснети' },
  { k: 'mgmt', n: 'Раководството писмено ја потврди одговорноста за финансиските извештаи (ISRS 4410 §39)' },
];

export const QC_DECISIONS = [['accept', 'Се прифаќа (нов клиент)'], ['continue', 'Се продолжува'], ['decline', 'Се одбива / се прекинува']] as const;
export type QcDecision = (typeof QC_DECISIONS)[number][0];
export const QC_RISK = [['low', 'низок'], ['mid', 'среден'], ['high', 'висок']] as const;
export type QcRisk = (typeof QC_RISK)[number][0];

export interface QcData {
  /** Manual acceptance items ticked (`QC_ACCEPT` without `auto`). */
  acc: Record<string, boolean>;
  /** Engagement risk when there is no УФР analysis (the УФР level wins). */
  risk?: QcRisk | null;
  decision?: QcDecision | null; decidedBy?: string | null; decidedOn?: string | null; accNote?: string;
  /** Review items ticked (`QC_REVIEW`). */
  rev: Record<string, boolean>;
  preparedBy?: string | null; reviewedBy?: string | null; reviewedOn?: string | null; revNote?: string;
  /** A reviewer outside the office (another ИСОС member) – for a one-person office. */
  reviewedExt?: string;
  /** The engagement file (ISRS 4410 §37–39). */
  doc?: ElFile;
}

/** What the system already knows about the engagement. */
export interface QcAuto {
  /** The firm's УФР file (`aml_records`): level, last and next review. */
  aml: { level: string | null; last: string | null; next: string | null } | null;
  ethics: { signed: number; total: number };
  contract: boolean;
  letter: 'signed' | 'draft' | null;
}

/** The engagement file per firm and year (ISRS 4410 §37–39), kept with the ISQM 1 checklist (`qc` row, `doc`). */
export interface ElFile { matters: string; judgments: string; commOn: string | null; comm: string; ackOn: string | null; ackBy: string; reportOn: string | null; fsDate: string | null }
export function elFileNormalize(v: Record<string, unknown> | null | undefined): ElFile {
  const d = (v ?? {}) as Record<string, unknown>;
  const str = (x: unknown, max = 4000) => String(x ?? '').trim().slice(0, max);
  return {
    matters: str(d.matters), judgments: str(d.judgments), comm: str(d.comm), ackBy: str(d.ackBy, 200),
    commOn: isDate(d.commOn) ? d.commOn : null, ackOn: isDate(d.ackOn) ? d.ackOn : null, reportOn: isDate(d.reportOn) ? d.reportOn : null, fsDate: isDate(d.fsDate) ? d.fsDate : null,
  };
}
/** The engagement file is complete: matters and judgments noted, communication with management, management's written acknowledgement, the report dated. */
export function elFileStatus(f: ElFile, files: number) {
  const L: [string, boolean][] = [
    ['Значајни прашања во ангажманот', !!f.matters], ['Значајни проценки (резервирања, вредности, пописи)', !!f.judgments],
    ['Комуникација со раководството (датум и содржина)', !!f.commOn && !!f.comm], ['Писмена потврда на раководството за одговорноста (§39)', !!f.ackOn && !!f.ackBy],
    ['Извештај за составување – датум', !!f.reportOn], ['Доказ во прилог (потпишана потврда, преписка)', files > 0],
  ];
  return { items: L, done: L.filter(([, x]) => x).length, total: L.length, ok: L.every(([, x]) => x) };
}

export const qcEmpty = (): QcData => ({ acc: {}, rev: {} });

const pick = <T extends string>(v: unknown, L: readonly (readonly [T, string])[]): T | null => (L.some((x) => x[0] === v) ? (v as T) : null);
const uid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const flags = (v: unknown, L: readonly QcItem[]) => Object.fromEntries(L.filter((x) => !x.auto && (v as Record<string, unknown> | null)?.[x.k] === true).map((x) => [x.k, true]));

/** Normalise stored / posted checklist data. */
export function qcNormalize(v: Partial<QcData> & Record<string, unknown>): QcData {
  return {
    acc: flags(v.acc, QC_ACCEPT), risk: pick(v.risk, QC_RISK), decision: pick(v.decision, QC_DECISIONS),
    decidedBy: uid(v.decidedBy), decidedOn: isDate(v.decidedOn) ? v.decidedOn : null, accNote: String(v.accNote ?? '').slice(0, 2000),
    rev: flags(v.rev, QC_REVIEW), preparedBy: uid(v.preparedBy), reviewedBy: uid(v.reviewedBy), reviewedOn: isDate(v.reviewedOn) ? v.reviewedOn : null,
    revNote: String(v.revNote ?? '').slice(0, 2000), reviewedExt: String(v.reviewedExt ?? '').trim().slice(0, 200), doc: elFileNormalize(v.doc as unknown as Record<string, unknown>),
  };
}

/** The reviewer is a second person: a colleague other than the preparer, or a named external reviewer. */
export const qcSecond = (q: QcData) => !!q.preparedBy && ((!!q.reviewedBy && q.reviewedBy !== q.preparedBy) || !!q.reviewedExt);
/** The final accounts reviewed: second person, date, every review item. */
export const qcReviewed = (q: QcData | null | undefined): boolean => !!q && qcSecond(q) && !!q.reviewedOn && QC_REVIEW.every((x) => q.rev[x.k]);

/** A rule broken by the data (shown as the save error), or null. */
export function qcValidate(q: QcData): string | null {
  if (q.reviewedBy && q.preparedBy && q.reviewedBy === q.preparedBy) return 'Прегледот на завршната сметка го прави второ лице – не може да биде истиот што ја изготвил (ISQM 1).';
  if ((q.reviewedBy || q.reviewedExt) && !q.reviewedOn) return 'Внесете го датумот на прегледот.';
  if (q.decision && (!q.decidedBy || !q.decidedOn)) return 'Внесете кој и кога ја донел одлуката за прифаќање.';
  return null;
}

const AML_PILL: Record<string, string> = { low: 'низок', mid: 'среден', midhi: 'средно-висок', high: 'висок' };

export interface QcLine { k: string; n: string; ok: boolean; auto: boolean; info?: string }

/** The checklist with the system facts filled in: per item ok, and whether each part is complete. */
export function qcStatus(q: QcData, a: QcAuto, today: string) {
  const amlOk = !!a.aml?.last && (!a.aml.next || a.aml.next >= today);
  const auto: Record<string, [boolean, string]> = {
    aml: [amlOk, a.aml ? (a.aml.last ? `анализа ${dmy(a.aml.last)}${a.aml.next ? `, следна ${dmy(a.aml.next)}${a.aml.next < today ? ' – истечена' : ''}` : ''}` : 'досието постои, анализата не е завршена') : 'нема УФР досие'],
    risk: [!!(a.aml?.level || q.risk), a.aml?.level ? `според УФР: ${AML_PILL[a.aml.level] ?? a.aml.level}` : q.risk ? `рачно: ${QC_RISK.find((x) => x[0] === q.risk)![1]}` : 'не е проценет'],
    ethics: [a.ethics.total > 0 && a.ethics.signed >= a.ethics.total, `${a.ethics.signed} / ${a.ethics.total} потпишани`],
    contract: [a.contract, a.contract ? 'потпишан' : 'нема потпишан договор'],
    letter: [a.letter === 'signed', a.letter === 'signed' ? 'потпишано' : a.letter === 'draft' ? 'чека потпис' : 'нема писмо'],
  };
  const acc: QcLine[] = QC_ACCEPT.map((x) => (x.auto ? { k: x.k, n: x.n, auto: true, ok: auto[x.k]![0], info: auto[x.k]![1] } : { k: x.k, n: x.n, auto: false, ok: !!q.acc[x.k] }));
  const rev: QcLine[] = QC_REVIEW.map((x) => ({ k: x.k, n: x.n, auto: false, ok: !!q.rev[x.k] }));
  const decided = (q.decision === 'accept' || q.decision === 'continue') && !!q.decidedOn;
  const accOk = decided && acc.every((x) => x.ok);
  const second = qcSecond(q);
  const revOk = second && !!q.reviewedOn && rev.every((x) => x.ok);
  return {
    accept: { items: acc, done: acc.filter((x) => x.ok).length, total: acc.length, decided, declined: q.decision === 'decline', ok: accOk },
    review: { items: rev, done: rev.filter((x) => x.ok).length, total: rev.length, second, by: q.reviewedBy ?? null, on: q.reviewedOn ?? null, ok: revOk },
    ok: accOk && revOk,
  };
}

/* ================= IESBA – yearly ethics declaration ================= */

export const ETHICS_VERSION = 'IESBA 2026';
export const ethicsTrainingTitle = (year: number) => `Кодекс на етика (IESBA) – годишни изјави ${year}`;

/** The declaration text (paragraphs) for one employee and year. */
export function ethicsText(office: string, name: string, year: number, x: { clients?: readonly string[]; conflicts?: string } = {}): string[] {
  const o = office || 'канцеларијата';
  return [
    `Јас, ${name || '____________________'}, вработен/а во ${o}, изјавувам дека го прочитав и го разбрав Кодексот на етика за професионални сметководители на IESBA (како што го применува ИСОС) и дека во ${year} година ќе ги почитувам неговите основни начела:`,
    '1. Интегритет – искреност и чесност во сите професионални и деловни односи.',
    '2. Објективност – без пристрасност, судир на интереси или несоодветно влијание од други.',
    '3. Професионална компетентност и должно внимание – знаење на тековно ниво, работа според стандардите и законите, навремено.',
    '4. Доверливост – податоците на клиентите и на канцеларијата не ги откривам надвор, ниту ги користам за лична корист, и по престанокот на работата.',
    '5. Професионално однесување – почитување на законите и избегнување постапки што ја нарушуваат довербата во професијата.',
    'Изјавувам дека немам финансиски интерес, семејна или блиска деловна врска со клиент на канцеларијата што би ја загрозила мојата објективност, освен оние што писмено ги пријавив на управителот. Секој судир на интереси, подарок, понуда или притисок ќе го пријавам веднаш.',
    'Ќе ги почитувам обврските според Законот за спречување перење пари и финансирање тероризам: сомнителна трансакција ја пријавувам кај овластеното лице и за пријавата не го известувам клиентот.',
    'Доверливост: податоците и документите на клиентите и на канцеларијата ги користам само за работата, не ги праќам на приватни адреси или уреди и не ги откривам на трети лица, освен кога тоа го бара закон.',
    ...(x.clients?.length ? [`Клиенти на кои работам во ${year}: ${x.clients.join(', ')}. За секој од нив изјавувам дека сум независен/на и немам судир на интереси${x.conflicts ? ', освен следното' : ''}.`] : []),
    ...(x.conflicts ? [`Пријавени врски / судир на интереси: ${x.conflicts}`] : []),
  ];
}

export interface EthicsRow { userId: string; name: string; at: string | null }

/** The ISO „Обуки“ record of the year's declarations (ISO 9001 §7.2–7.3): participants, date, evidence; closed when all signed. */
export function ethicsTraining(rows: readonly EthicsRow[], office: string, year: number) {
  const signed = rows.filter((r) => r.at).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const last = signed.length ? String(signed[signed.length - 1]!.at).slice(0, 10) : null;
  return {
    title: ethicsTrainingTitle(year),
    status: (rows.length > 0 && signed.length === rows.length ? 'done' : 'progress') as 'done' | 'progress',
    data: {
      who: signed.map((r) => r.name).join(', '), topic: 'Кодекс на етика за професионални сметководители (IESBA) – годишна изјава',
      provider: office, date: last, hours: '1', evidence: `Потпишани изјави во WISE: ${signed.length} / ${rows.length} (${ETHICS_VERSION})`,
      // the ISO training record closes only with a competence evaluation: the signed declaration is the confirmation
      evaluation: signed.length ? `Секој потписник со потписот потврдува дека го прочитал и го разбира кодексот (${signed.length} / ${rows.length})` : null,
    } as Record<string, unknown>,
  };
}

/* ================= the year's overview (ISO management review, the office screen) ================= */

export interface IfacRow { kind: IfacKind; year: number; subject: string; status: string; data: Record<string, unknown> }

/** For the management review: letters, acceptance, the second-person reviews and the declarations of one year. */
export function ifacReview(R: readonly IfacRow[], year: number, firms: number, employees: number) {
  const Y = R.filter((r) => r.year === year);
  const L = Y.filter((r) => r.kind === 'letter'), Q = Y.filter((r) => r.kind === 'qc').map((r) => qcNormalize(r.data as never));
  return {
    firms,
    letters: { signed: L.filter((r) => r.status === 'signed').length, draft: L.filter((r) => r.status !== 'signed').length, missing: Math.max(0, firms - L.length) },
    accept: { decided: Q.filter((q) => (q.decision === 'accept' || q.decision === 'continue') && q.decidedOn).length, declined: Q.filter((q) => q.decision === 'decline').length },
    review: { done: Q.filter(qcReviewed).length },
    ethics: { signed: Y.filter((r) => r.kind === 'ethics').length, total: employees },
  };
}
