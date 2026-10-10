/**
 * Accounting-service contract (Договор за сметководствени услуги) — legacy 10322–10397 (`KD_SVC`, `kdVat`, `kdAmt`,
 * `kdWords`, `KD_ST`, `kdNew`, `kdHTML`), 13554–13616 (`offFirm`, `kdRecPlan`, `kdIndex` v415, `kdDraftArch`),
 * 15504 (`kdDpaAnnex`), 15587–15608 (`docHead` memo, `docFoot` control code, `kdCode`).
 *
 * Pure: the screen (`apps/web/app/(app)/kdogovori`) stores the contract in `service_contracts` (fields below in
 * `data`), the office data in `app_settings.office` and renders the HTML returned here for the preview, the print
 * view / server PDF and the signed copy archived in the dossier.
 *
 * Money: amounts are computed in integer cents (legacy `r2` on floats).
 */
import { hrDocCode } from '../payroll/hr';
import { mkWords } from '../sales/words';
import { ZZ_SUB_DEF } from '../office/gdpr';
import { firstLastWorkingDay, lastWorkingDay } from '../office/recurring';

export const KD_SVC = [
  ['book', 'Водење на деловните книги (главна книга, аналитика, налози за книжење)'],
  ['vat', 'Пресметка и поднесување на ДДВ пријави и водење книги за ДДВ'],
  ['pay', 'Пресметка на плати, МПИН и пријави до УЈП / Фонд'],
  ['cash', 'Благајничко работење и книжење на банкарски изводи'],
  ['stock', 'Материјално книговодство (залиха, калкулации, КДФИ, ЕТ/МЕТГ)'],
  ['year', 'Годишна сметка, даночен биланс и статистички извештаи'],
  ['inv', 'Изготвување излезни фактури по барање на нарачателот'],
  ['rep', 'Застапување пред УЈП и други институции по писмено овластување'],
  ['cons', 'Сметководствени и даночни консултации'],
] as const;
export const KD_SVC_DEF = ['book', 'vat', 'pay', 'cash', 'year'];

/** Dossier category of the archived contract (legacy splices it into `DOS_CAT`). */
export const KD_DOS_CAT = 'Договор за сметководствени услуги';

/** Office data (legacy `S.kdOff` = `appsettings/office`). `sig` / `stamp` are file ids. */
export interface KdOffice {
  name?: string; address?: string; city?: string; edb?: string; embs?: string; lic?: string; rep?: string; repRole?: string;
  fee?: number | string; docDay?: number; feeMode?: 'gross' | 'net'; vatOn?: boolean; vatRate?: number;
  feeEmp?: number | string; empFree?: number; feeYear?: number | string; feeHour?: number | string;
  sig?: string | null; stamp?: string | null; phone?: string; email?: string; logo?: string | null;
  zzlp?: { subs?: string[][] };
}

export interface KdSig { sig?: string | null; stamp?: string | null; at: string; by?: string; name?: string; scan?: string | null }

/** A contract (legacy `docs.type='kdog'`). Amounts as entered (`feeMode` says with or without VAT). */
export interface KdContract {
  id?: string; number: string; date: string; place: string; start: string; dur: 'indef' | 'def'; end: string;
  rep: string; repRole: string; feeMode: 'gross' | 'net'; fee: number | string; empFree: number; feeEmp: number | string;
  feeYear: number | string; feeHour: number | string; docDay: number; payDay: number; notice: number; note: string;
  svc: string[]; noDpa?: boolean; offSig?: KdSig | null; cliSig?: KdSig | null; arch?: string | null; draftArch?: string | null;
}

export interface KdFirm { name?: string | null; address?: string | null; city?: string | null; edb?: string | null; embs?: string | null; phone?: string | null; email?: string | null; bank?: string | null; logo?: string | null; manager?: string | null }

/** Legacy `kdVat`: the office's VAT rate (0 when not a VAT payer). */
export const kdVat = (O: KdOffice | null | undefined): number => (O?.vatOn === false ? 0 : Number(O?.vatRate) || 18);

/** Legacy `kdAmt`: net and gross of an amount entered with (`gross`) or without (`net`) VAT. Integer-cent math. */
export function kdAmt(feeMode: string | undefined, v: number | string | null | undefined, rate: number): { net: number; gross: number } {
  const c = Math.round((Number(v) || 0) * 100);
  if (!c) return { net: 0, gross: 0 };
  if (feeMode === 'gross') return { gross: c / 100, net: Math.round((c * 100) / (100 + rate)) / 100 };
  return { net: c / 100, gross: Math.round((c * (100 + rate)) / 100) / 100 };
}

/** Legacy `kdWords`: „… денари и NN/100“. */
export function kdWords(v: number): string {
  const c = Math.round((Number(v) || 0) * 100);
  const w = Math.floor(c / 100), cents = c % 100;
  return mkWords(w) + ' денари' + (cents ? ' и ' + String(cents).padStart(2, '0') + '/100' : '');
}

/** Legacy `KD_ST`: status label and pill class. */
export function kdStatus(k: Pick<KdContract, 'arch' | 'cliSig' | 'offSig'>): [string, string] {
  return k.arch ? ['потпишан и архивиран', 'good'] : k.cliSig ? ['потпишан од двете страни', 'good'] : k.offSig ? ['чека потпис од клиентот', 'warn'] : ['нацрт', 'info'];
}

/** Value of `service_contracts.status` for a contract. */
export const kdStatusCode = (k: Pick<KdContract, 'arch' | 'cliSig' | 'offSig'>): string => (k.arch || k.cliSig ? 'signed' : k.offSig ? 'sent' : 'draft');

/** Legacy `kdNew`: a new contract prefilled from the office defaults and the firm. */
export function kdNew(O: KdOffice, f: KdFirm & { signer?: string | null; rep?: string | null }, today: string): KdContract {
  return {
    number: '', date: today, place: O.city || f.city || '', start: today, dur: 'indef', end: '', svc: [...KD_SVC_DEF],
    feeMode: O.feeMode || 'gross', fee: O.fee || '', feeEmp: O.feeEmp || '', empFree: Number(O.empFree) || 3, feeYear: O.feeYear || '', feeHour: O.feeHour || '',
    payDay: 10, docDay: Number(O.docDay) || 5, notice: 30, rep: f.signer || f.rep || '', repRole: 'Управител', note: '',
  };
}

/** Legacy `kdNextNo` format: `СУ-001/2026`. */
export const kdNumber = (n: number, year: number | string) => `СУ-${String(n).padStart(3, '0')}/${year}`;

/** Legacy `kdCode` (docCode over the contract's essential content). */
export const kdCode = (k: Partial<KdContract>, firmId: string): string =>
  hrDocCode({ t: 'kd', id: k.id, no: k.number, f: firmId, fee: k.fee, svc: k.svc, d: k.date, dpa: !k.noDpa });

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dmy = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');
const fmt = (n: number) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dig = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

/** Legacy `docHead`: the office memo on top of the document. */
export function kdDocHead(F: KdFirm, o: { conf?: boolean; code?: string; logoSrc?: string | null } = {}): string {
  const ln = [[F.address, F.city].filter(Boolean).join(', '), F.edb ? 'ЕДБ ' + F.edb : '', F.embs ? 'ЕМБС ' + F.embs : ''].filter(Boolean).join(' · ');
  const ln2 = [F.phone ? 'Тел. ' + F.phone : '', F.email || '', F.bank ? 'Ж-сметка ' + F.bank : ''].filter(Boolean).join(' · ');
  const ini = String(F.name || '?').replace(/^(ДРУШТВО|ДООЕЛ|ДОО|АД)\s+/i, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `<div class="dochead" style="display:flex;align-items:center;gap:12px;border-bottom:2px solid #0d5b4b;padding:0 0 6px;margin:0 0 10px;font-family:Arial,Helvetica,sans-serif">
   ${o.logoSrc ? `<img src="${esc(o.logoSrc)}" alt="" style="max-height:16mm;max-width:45mm;object-fit:contain">` : `<div style="width:13mm;height:13mm;border-radius:3mm;background:#0d5b4b;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px">${esc(ini)}</div>`}
   <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:12.5px;color:#0d5b4b;text-transform:uppercase">${esc(F.name || '')}</div><div style="font-size:9px;color:#444">${esc(ln)}</div>${ln2 ? `<div style="font-size:9px;color:#444">${esc(ln2)}</div>` : ''}</div>
   <div style="text-align:right;font-size:8.5px;color:#444;line-height:1.35">${o.conf ? '<div style="display:inline-block;border:1px solid #b42318;color:#b42318;font-weight:700;padding:1px 6px;border-radius:3px;letter-spacing:.5px;margin-bottom:2px">ДОВЕРЛИВО</div><br>' : ''}${o.code ? `Контролен код<br><b style="font-family:monospace;font-size:10px;color:#111">${esc(o.code)}</b>` : ''}</div></div>`;
}

/** Legacy `docFoot`. */
export const kdDocFoot = (code: string, txt: string) =>
  `<p class="docfoot" style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:8.5px;color:#555;border-top:1px solid #ccc;padding-top:4px">${txt ? esc(txt) + ' ' : ''}Контролен код: <b style="font-family:monospace">${esc(code)}</b> – кодот се пресметува од содржината; ако некој податок во документот е изменет, кодот повеќе не се совпаѓа со оригиналот зачуван во програмата.</p>`;

const DRAFT_MARK = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0"><div style="transform:rotate(-30deg);font-size:90px;font-weight:800;color:rgba(180,35,24,.10);letter-spacing:10px;font-family:Arial">НАЦРТ</div></div>';

/** Legacy `kdDpaAnnex`: articles 1–7 of the DPA (`zzDpa`) and its security measures, as Annex 1 of the contract. */
export function kdDpaAnnex(k: Pick<KdContract, 'number' | 'date'>, O: KdOffice, peekNo = ''): string {
  const subs = Array.isArray(O.zzlp?.subs) && O.zzlp!.subs!.length ? O.zzlp!.subs! : ZZ_SUB_DEF.map((s) => [...s]);
  const c = (t: string) => `<div style="text-align:center;font-weight:700;margin-top:10px">${esc(t)}</div>`;
  const c2 = (t: string) => `<div style="text-align:center;font-style:italic;margin-bottom:4px">${esc(t)}</div>`;
  const p = (t: string) => `<p style="text-align:justify;margin:0 0 8px">${esc(t)}</p>`;
  const body = [
    c('Член 1'), c2('Предмет'),
    p('Обработувачот обработува лични податоци во име и за сметка на Контролорот, исклучиво за извршување на сметководствените услуги што ги договориле страните: водење деловни книги, пресметка на плати и придонеси, изготвување и поднесување пријави до Управата за јавни приходи, Фондот за пензиско и инвалидско осигурување, Агенцијата за вработување, Централниот регистар и други институции, како и чување на сметководствената документација.'),
    c('Член 2'), c2('Категории на субјекти и лични податоци'),
    p('Се обработуваат лични податоци за: вработените кај Контролорот (име и презиме, ЕМБГ, адреса, број на трансакциска сметка, плата, придонеси, работен стаж, отсуства и боледувања во обем потребен за пресметка на плата), сопствениците и управителите на Контролорот, и физичките лица кои се деловни партнери на Контролорот (име и презиме, ЕМБГ/ЕДБ, адреса, сметка). Обработувачот не обработува други посебни категории на лични податоци, освен податоците за боледување неопходни за пресметка на надоместокот.'),
    c('Член 3'), c2('Времетраење'),
    p('Обработката трае додека трае договорот за сметководствени услуги. По неговото престанување, Обработувачот ги враќа податоците на Контролорот или, по негово барање, ги брише, освен податоците што според закон мора да се чуваат – тие се чуваат до истекот на законскиот рок, а потоа се бришат.'),
    c('Член 4'), c2('Обврски на Обработувачот'),
    p('Обработувачот: 1) ги обработува личните податоци само според документирани упатства од Контролорот, освен кога обработката ја бара закон; 2) обезбедува лицата овластени за обработка да се обврзале на доверливост (писмена изјава); 3) ги применува техничките и организациските мерки од член 36 од Законот, наведени во Анекс 1 кон овој договор; 4) му помага на Контролорот при одговарање на барањата на субјектите на личните податоци; 5) го известува Контролорот без одложување, а најдоцна во рок од 24 часа, откако ќе дознае за нарушување на безбедноста на личните податоци; 6) му ги става на располагање на Контролорот сите информации потребни за докажување на усогласеноста и овозможува проверки.'),
    c('Член 5'), c2('Подобработувачи'),
    p('Контролорот дава општо писмено овластување Обработувачот да ги ангажира следните подобработувачи, со кои Обработувачот има склучено договори со истите обврски за заштита на личните податоци:'),
    ...subs.map((s, i) => p(`${i + 1}) ${s[0]}, ${s[1]} – ${s[2]} (локација: ${s[3]}).`)),
    p('За секој нов подобработувач Обработувачот однапред писмено го известува Контролорот, кој има право да се спротивстави во рок од 15 дена.'),
    c('Член 6'), c2('Пренос во други држави'),
    p('Личните податоци се чуваат на сервери во земји членки на Европската унија. Пренос во трети држави се врши само кон подобработувачите наведени во член 5 и само со соодветни заштитни мерки согласно Законот.'),
    c('Член 7'), c2('Одговорност'),
    p('Секоја страна одговара за штета предизвикана со повреда на обврските од овој договор и од Законот за заштита на личните податоци.'),
  ].join('');
  const mer = [
    '1. Шифрирање: сите документи и датотеки се чуваат шифрирани (AES-256-GCM); врската е само преку HTTPS (TLS).',
    '2. Пристап: лична корисничка сметка за секое лице, силна лозинка и двостепена најава (код од телефон); улоги и права по фирма; бришење и корекции само од одговорното лице.',
    '3. Ограничување: вработените пристапуваат само од просториите на Обработувачот и само од одобрени компјутери; автоматска одјава по 15 минути неактивност.',
    '4. Спречување изнесување: преземање на збирни податоци (Excel, архиви, извоз) само од одговорното лице; секој преземен документ носи ознака на корисникот и времето; известување за необични активности.',
    '5. Евиденција: секоја најава, промена, бришење, преземање и пристап до документ се запишува со корисник, време и IP адреса.',
    '6. Достапност и копии: два сервери во различни центри за податоци во ЕУ со автоматско префрлање; дневни шифрирани резервни копии, од кои една се чува во просториите на Обработувачот; редовна проверка на враќањето.',
    '7. Сервери: firewall, заштита од обиди за упад, автоматски безбедносни ажурирања, база недостапна од интернет.',
    '8. Организациски: изјави за доверливост од вработените, обука, внатрешни правила за постапување со лични податоци.',
  ].map(p).join('');
  return `<div style="page-break-before:always;break-before:page"></div><div style="font-family:'Times New Roman',Georgia,serif;font-size:12px;line-height:1.5;color:#111;margin-top:18px">
   <h2 style="text-align:center;font-size:15px;margin:0">АНЕКС 1</h2><p style="text-align:center;margin:0 0 4px"><b>Обработка на лични податоци</b></p>
   <p style="text-align:center;margin:0 0 10px;font-style:italic">составен дел од Договорот за вршење на сметководствени услуги бр. ${esc(k.number || peekNo || '______')} од ${k.date ? dmy(k.date) : '__________'} година (член 32 од Законот за заштита на личните податоци, „Службен весник на РСМ“ бр. 42/2020)</p>
   <p style="text-align:justify;margin:0 0 8px">Во овој анекс, <b>нарачателот</b> е Контролор, а <b>давателот на услугата</b> е Обработувач на личните податоци.</p>
   ${body}
   <p style="text-align:center;font-weight:700;margin-top:10px">Член 8</p><p style="text-align:center;font-style:italic;margin-bottom:4px">Завршна одредба</p><p style="text-align:justify;margin:0 0 8px">Анексот важи додека важи Договорот за вршење на сметководствени услуги и се потпишува заедно со него. Со престанокот на договорот, Обработувачот постапува според член 3 од овој анекс.</p>
   <p style="text-align:center;font-weight:700;margin-top:14px">Прилог: Технички и организациски мерки за безбедност</p>${mer}</div>`;
}

export interface KdHtmlCtx {
  firm: KdFirm; firmId: string; O: KdOffice;
  /** The office firm (memo: logo, phone, e-mail, bank) — legacy `offFirm()`. */
  off?: KdFirm | null;
  /** Number shown on a draft without one (legacy `kdPeekNo`). */
  peekNo?: string;
  /** Signed electronically through the portal (legacy `opt.e`). */
  e?: boolean;
  /** URL of a stored image (signature, stamp, logo). */
  img: (fileId: string) => string;
  /** Show the „НАЦРТ“ watermark on unsigned contracts. */
  draftMark?: boolean;
}

/** Legacy `kdHTML` + the memo wrapper (15608): the full contract as HTML. */
export function kdHtml(k: KdContract, x: KdHtmlCtx): string {
  const f = x.firm, O = x.O;
  const b = (v: unknown) => (v ? esc(v) : '____________________');
  const n = (v: unknown) => (Number(v) ? fmt(Number(v)) : '________');
  const d = (v: string | null | undefined) => (v ? dmy(v) : '__________');
  let a = 0;
  const art = (t: string) => { a++; return `<p style="text-align:center;margin:12px 0 4px"><b>Член ${a}</b></p><p style="margin:0;text-align:justify">${t}</p>`; };
  const S2 = KD_SVC.filter((s) => (k.svc || []).includes(s[0]));
  const r = kdVat(O);
  const A = kdAmt(k.feeMode, k.fee, r);
  const one = (v: unknown) => { const q = kdAmt(k.feeMode, v as number, r); return r ? `${n(q.net)} денари без ДДВ (${n(q.gross)} денари со ДДВ)` : `${n(q.net)} денари`; };
  const main = !Number(k.fee) ? `<b>________</b> денари${r ? ' без ДДВ' : ''}`
    : r ? `<b>${n(A.net)}</b> денари (со зборови: ${esc(kdWords(A.net))}) без ДДВ, односно <b>${n(A.gross)}</b> денари (со зборови: ${esc(kdWords(A.gross))}) со вклучен ДДВ од ${r}%`
      : `<b>${n(A.net)}</b> денари (со зборови: ${esc(kdWords(A.net))})`;
  const sigBox = (who: string, name: string | undefined, role: string | undefined, sg: string | null | undefined, stamp: string | null | undefined) =>
    `<div style="text-align:center;min-width:72mm;position:relative"><b>${who}</b><div style="height:62px;position:relative;margin-top:6px">${sg ? `<img src="${esc(x.img(sg))}" style="height:58px;object-fit:contain;position:relative;z-index:2">` : ''}${stamp ? `<img src="${esc(x.img(stamp))}" style="height:30mm;max-width:34mm;object-fit:contain;position:absolute;left:58%;top:-14px;opacity:.9;z-index:1">` : ''}</div><div style="border-top:1px solid #111;padding-top:3px">${esc(name || '')}${role ? '<br><small>' + esc(role) + '</small>' : ''}</div></div>`;
  const H = `<div style="font-family:'Times New Roman',Georgia,serif;font-size:12px;line-height:1.5;color:#111">
  <p>Врз основа на Законот за облигационите односи и Законот за вршење на сметководствени работи, на ден ${d(k.date)} година во ${b(k.place)}, се склучи:</p>
  <h1 style="text-align:center;font-family:'Times New Roman',serif;font-size:17px;margin:14px 0 2px">ДОГОВОР<br>за вршење на сметководствени услуги</h1><p style="text-align:center;margin:0 0 10px">бр. ${k.number ? esc(k.number) : x.peekNo ? esc(x.peekNo) : b('')}</p>
  <p style="margin:0">помеѓу:</p><p style="margin:4px 0 4px 18px">1. <b>${b(O.name)}</b>, со седиште на ${b([O.address, O.city].filter(Boolean).join(', '))}, ЕДБ ${b(O.edb)}, ЕМБС ${b(O.embs)}${O.lic ? ', запишан во регистарот на даватели на сметководствени услуги / со одобрение бр. ' + esc(O.lic) : ''}, застапувано од ${b(O.rep)} – ${b(O.repRole || 'Управител')} (во понатамошниот текст: <b>давател на услугата</b>), и</p>
  <p style="margin:0 0 8px 18px">2. <b>${b(f.name)}</b>, со седиште на ${b([f.address, f.city].filter(Boolean).join(', '))}, ЕДБ ${b(f.edb)}, ЕМБС ${b(f.embs)}, застапувано од ${b(k.rep)} – ${b(k.repRole)} (во понатамошниот текст: <b>нарачател</b>).</p>
  ${art(`Предмет на овој договор е вршење на сметководствени услуги од страна на давателот на услугата за потребите на нарачателот, и тоа:<br>${S2.map((s, i) => i + 1 + '. ' + esc(s[1])).join(';<br>')}${k.note ? ';<br>' + (S2.length + 1) + '. ' + esc(k.note) : ''}.<br>Услугите се вршат согласно Законот за трговските друштва, Законот за вршење на сметководствени работи, сметководствените стандарди и даночните прописи во Република Северна Македонија.`)}
  ${art(`Нарачателот се обврзува на давателот на услугата да му ги доставува сите сметководствени исправи (влезни и излезни фактури, банкарски изводи, благајнички документи, фискални извештаи, пресметки и други документи) за претходниот месец најдоцна до <b>${esc(k.docDay)}-ти</b> во тековниот месец, комплетни, точни и навремено, преку порталот за клиенти или во хартиена форма. Нарачателот одговара за веродостојноста, законитоста и точноста на исправите што ги доставува.`)}
  ${art('Давателот на услугата се обврзува услугите да ги врши стручно, совесно и во законските рокови, врз основа на доставените исправи. Давателот на услугата не одговара за последиците (казни, камати, пропуштени рокови) настанати поради недоставени, задоцнети, нецелосни или невистинити исправи и податоци од нарачателот.')}
  ${art(`За извршените услуги нарачателот на давателот на услугата му плаќа месечен надоместок во износ од ${main}${Number(k.feeEmp) ? `, а за секој вработен над ${esc(k.empFree)} вработени дополнително ${one(k.feeEmp)} месечно` : ''}${Number(k.feeYear) ? `. За изготвување на годишната сметка и даночниот биланс нарачателот плаќа еднократно ${one(k.feeYear)}` : ''}${Number(k.feeHour) ? `. Услугите што не се опфатени со член 1 се наплаќаат по ${one(k.feeHour)} за час` : ''}. Надоместокот се плаќа врз основа на фактура најдоцна до <b>${esc(k.payDay)}-ти</b> во месецот за претходниот месец.${r ? '' : ' Давателот на услугата не е обврзник за ДДВ.'}`)}
  ${art(`Давателот на услугата се обврзува како деловна тајна да ги чува сите податоци и документи на нарачателот до кои ќе дојде при вршењето на услугите, и по престанокот на договорот. Во однос на личните податоци на вработените и деловните партнери на нарачателот, давателот на услугата постапува како обработувач на лични податоци, исклучиво по упатство на нарачателот и за целите на овој договор, со примена на соодветни технички и организациски мерки согласно Законот за заштита на личните податоци.${k.noDpa ? '' : ' Обработката на личните податоци поблиску е уредена во <b>Анекс 1 – Обработка на лични податоци</b>, кој е составен дел од овој договор (член 32 од Законот за заштита на личните податоци).'}`)}
  ${art('Нарачателот го овластува давателот на услугата да ги поднесува пријавите и извештаите до Управата за јавни приходи, Централниот регистар и другите институции во негово име, преку електронските системи, врз основа на овој договор и посебно овластување кога тоа е потребно.')}
  ${art(`Договорот се склучува ${k.dur === 'indef' ? 'на неопределено време' : `на определено време до ${d(k.end)} година`}, ${k.start && k.date && k.start < k.date ? `и ги уредува односите во соработката меѓу страните која трае од ${d(k.start)} година, со што ги потврдува и сите услуги извршени од тој датум` : `со почеток на примена од ${d(k.start)} година`}. Секоја страна може да го раскине договорот со писмено известување и отказен рок од <b>${esc(k.notice)}</b> дена. Во отказниот рок давателот на услугата е должен да ги заврши започнатите работи за периодот за кој е платен надоместокот.`)}
  ${art('По престанокот на договорот, давателот на услугата ќе му ги предаде на нарачателот сите деловни книги, исправи и електронски податоци, со записник за примопредавање, под услов нарачателот да ги има подмирено обврските по овој договор.')}
  ${art(`За сè што не е уредено со овој договор се применуваат одредбите на Законот за облигационите односи и Законот за вршење на сметководствени работи. Евентуалните спорови страните ќе ги решаваат спогодбено, а доколку тоа не е можно, надлежен е судот во ${b(O.city || k.place)}.`)}
  ${art(`Договорот е составен во 2 (два) еднакви примероци, по еден за секоја договорна страна. Договорот е потпишан ${x.e ? 'електронски преку порталот (потпис со рака на екран, време и корисник се евидентирани)' : 'од овластените лица на двете страни'}.`)}
  <div class="sigrow" style="page-break-inside:avoid;break-inside:avoid;display:flex;justify-content:space-between;margin-top:34px;gap:30px">${sigBox('ДАВАТЕЛ НА УСЛУГАТА', O.rep, O.name, k.offSig ? k.offSig.sig || O.sig : null, k.offSig ? k.offSig.stamp || O.stamp : null)}${sigBox('НАРАЧАТЕЛ', k.cliSig?.name || k.rep, f.name ?? '', k.cliSig?.sig, k.cliSig?.stamp)}</div>
  ${k.offSig || k.cliSig ? `<p style="font-size:8.5pt;color:#555;margin-top:14px">${k.offSig ? 'Потпишано од давателот: ' + esc(String(k.offSig.at).slice(0, 16).replace('T', ' ')) + ' (' + esc(k.offSig.by || '') + ')' : ''}${k.cliSig ? ' · Потпишано од нарачателот: ' + esc(String(k.cliSig.at).slice(0, 16).replace('T', ' ')) + ' (' + esc(k.cliSig.by || k.cliSig.name || '') + ')' : ''}</p>` : ''}${k.noDpa ? '' : kdDpaAnnex(k, O, x.peekNo)}</div>`;
  const of = x.off ?? {};
  const memo: KdFirm = { ...of, name: O.name || of.name, address: O.address || of.address, city: O.city || of.city, edb: O.edb || of.edb, embs: O.embs || of.embs };
  const logo = O.logo || of.logo;
  const code = kdCode(k, x.firmId);
  const inner = kdDocHead(memo, { conf: true, code, logoSrc: logo ? x.img(logo) : null }) + H + kdDocFoot(code, 'Договор за сметководствени услуги' + (k.number ? ' бр. ' + k.number : '') + '.');
  const draft = !(k.offSig || k.cliSig) && x.draftMark;
  return draft ? `<div data-paraf="1" style="position:relative">${DRAFT_MARK}<div style="position:relative">${inner}</div></div>` : `<div data-paraf="1">${inner}</div>`;
}

/** Normalise a stored / posted contract (legacy defaults of `kdNew` for missing fields). */
export function kdNormalize(v: Partial<KdContract> & Record<string, unknown>, today: string): KdContract {
  const num = (x: unknown, def: number) => { const q = Math.round(Number(x)); return Number.isFinite(q) && q > 0 ? q : def; };
  const amt = (x: unknown) => { const q = Number(String(x ?? '').replace(',', '.')); return Number.isFinite(q) && q > 0 ? Math.round(q * 100) / 100 : ''; };
  const date = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : '');
  return {
    id: typeof v.id === 'string' ? v.id : undefined, number: String(v.number ?? ''), date: date(v.date) || today, place: String(v.place ?? ''),
    start: date(v.start) || date(v.date) || today, dur: v.dur === 'def' ? 'def' : 'indef', end: v.dur === 'def' ? date(v.end) : '',
    rep: String(v.rep ?? ''), repRole: String(v.repRole ?? ''), feeMode: v.feeMode === 'net' ? 'net' : 'gross', fee: amt(v.fee),
    empFree: Math.max(0, Math.round(Number(v.empFree) || 0)), feeEmp: amt(v.feeEmp), feeYear: amt(v.feeYear), feeHour: amt(v.feeHour),
    docDay: Math.min(28, num(v.docDay, 5)), payDay: Math.min(28, num(v.payDay, 10)), notice: num(v.notice, 30), note: String(v.note ?? ''),
    svc: Array.isArray(v.svc) ? v.svc.filter((s): s is string => typeof s === 'string' && KD_SVC.some((x) => x[0] === s)) : [...KD_SVC_DEF],
    noDpa: !!v.noDpa, offSig: (v.offSig as KdSig) ?? null, cliSig: (v.cliSig as KdSig) ?? null, arch: (v.arch as string) ?? null, draftArch: (v.draftArch as string) ?? null,
  };
}

/** Legacy `kdIndex` (+ v415 wrappers): the summary kept on the firm (`settings.kdog`) and the fee for the monthly invoice (`settings.accFee`). */
export function kdIndex(k: KdContract, rate: number): { kdog: Record<string, unknown>; accFee?: string } {
  const a = kdAmt(k.feeMode, k.fee, rate);
  const kdog = { id: k.id, no: k.number, date: k.date, fee: a.gross, st: kdStatus(k)[0], dpa: !k.noDpa, net: a.net, gross: a.gross, start: k.start || k.date, dur: k.dur, end: k.dur === 'indef' ? '' : k.end || '', payDay: k.payDay || '' };
  return a.net ? { kdog, accFee: a.net.toFixed(2) } : { kdog };
}

/* ---------------- Monthly invoices from the contracts (legacy `kdRecPlan` / `kdRecSync`, v415 `accFee`) ---------------- */

export interface KdRecFirm { id: string; name: string; edb?: string | null; embs?: string | null; active?: boolean; settings?: Record<string, unknown> | null }
export interface KdRecPartner { id: string; edb?: string | null; embs?: string | null }
export interface KdRecExisting { id: string; price: number; end: string | null }
export type KdRecSt = 'нова' | 'нова цена' | 'крај' | 'ок';
export interface KdRecRow { firm: KdRecFirm; net: number; start: string; end: string; no: string; partnerId: string | null; existing: KdRecExisting | null; st: KdRecSt }

/** The office firm (legacy `offFirm`): `settings.officeFirm`, else the firm with the office's ЕДБ. */
export function kdOfficeFirm<T extends { edb?: string | null; settings?: unknown }>(F: readonly T[], O: KdOffice | null | undefined): T | null {
  return F.find((f) => (f.settings as { officeFirm?: boolean } | null)?.officeFirm) ?? (O?.edb ? F.find((f) => dig(f.edb) && dig(f.edb) === dig(O.edb)) : undefined) ?? null;
}

/**
 * Legacy `kdRecPlan`: for every client firm with a monthly fee (`settings.accFee` net, else the contract summary
 * `settings.kdog`), the partner in the office firm and the recurring invoice already made for it (`settings.kdRecId`).
 */
export function kdRecPlan(firms: readonly KdRecFirm[], officeFirmId: string, partners: readonly KdRecPartner[], existing: ReadonlyMap<string, KdRecExisting>, rate: number): KdRecRow[] {
  const R: KdRecRow[] = [];
  for (const F of firms) {
    const s = (F.settings ?? {}) as { kdog?: { net?: number; gross?: number; fee?: number; start?: string; end?: string; no?: string }; accFee?: string | number; accFrom?: string; example?: boolean; archived?: boolean; kdRecId?: string };
    if (F.id === officeFirmId || s.example || s.archived || F.active === false) continue;
    const K = s.kdog ?? {};
    let net = 0;
    if (Number(s.accFee) > 0) net = Math.round(Number(s.accFee) * 100) / 100;
    else if (Number(K.net)) net = Number(K.net);
    else if (Number(K.gross) || Number(K.fee)) net = Math.round(((Number(K.gross) || Number(K.fee)) * 100 * 100) / (100 + rate)) / 100;
    if (!net) continue;
    const start = (Number(s.accFee) > 0 ? s.accFrom : '') || K.start || '';
    const end = K.end || '';
    const p = partners.find((x) => (dig(F.edb) && dig(x.edb) === dig(F.edb)) || (dig(F.embs) && dig(x.embs) === dig(F.embs)));
    const ex = s.kdRecId ? existing.get(s.kdRecId) ?? null : null;
    const st: KdRecSt = !ex ? 'нова' : Math.abs(ex.price - net) > 0.009 ? 'нова цена' : end && ex.end !== end ? 'крај' : 'ок';
    R.push({ firm: F, net, start, end, no: K.no || '', partnerId: p?.id ?? null, existing: ex, st });
  }
  return R;
}

/** First issue date of a new monthly invoice (legacy: last working day of the start month, not before today's). */
export function kdRecFirst(start: string, today: string): string {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : today;
  const a = lastWorkingDay(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1);
  const f = firstLastWorkingDay(today);
  return a > f ? a : f;
}
