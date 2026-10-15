/**
 * 📊 Продуктивност на вработените: how much WORK each colleague did, from `audit_log` (every mutation writes one row
 * in its own transaction). Pure: the classification of audit actions into work categories, the active-time estimate
 * and the aggregation per user / firm / day — the screen, the PDF print view and the Excel export all use this.
 *
 * - Every audit action maps to a work category + a verb (Креирано / Изменето / Избришано), or to `null` = not work
 *   (login / logout, settings, downloads, system jobs). Actions not in the table fall back to the entity type, then to
 *   „Друго“ — and are listed on the screen so the table can be extended.
 * - Journals posted as a by-product of a document (an invoice, a statement, a cash voucher, a payroll…) are not counted
 *   as a separate movement (the document is), but their lines count in the volume „ставки во налози“.
 * - Money is summed in integer cents.
 */
import { todaySkopje, addDays } from './dates';

export type WorkCat =
  | 'izlez' | 'vlez' | 'nalozi' | 'izvodi' | 'blagajna' | 'plati' | 'ddv' | 'magacin' | 'os' | 'firmi'
  | 'dokumenti' | 'ai' | 'zatvoranje' | 'dejnosti' | 'kanc' | 'drugo';
export type WorkVerb = 'c' | 'u' | 'd';

/** Categories in display order, with their Macedonian labels. */
export const WORK_CATS: readonly (readonly [WorkCat, string])[] = [
  ['izlez', 'Излезни фактури'],
  ['vlez', 'Влезни фактури / калкулации'],
  ['nalozi', 'Налози за книжење'],
  ['izvodi', 'Изводи'],
  ['blagajna', 'Благајна'],
  ['plati', 'Плати / персонал'],
  ['ddv', 'ДДВ и пријави'],
  ['magacin', 'Магацин / малопродажба'],
  ['os', 'Основни средства'],
  ['firmi', 'Фирми и шифрарници'],
  ['dokumenti', 'Документи (прикачени / скенирани)'],
  ['ai', 'AI читања'],
  ['zatvoranje', 'Затворање / завршна сметка'],
  ['dejnosti', 'Дејности (хотел, рент-а-кар, сервис, транспорт…)'],
  ['kanc', 'Канцеларија (задачи, договори, клиенти)'],
  ['drugo', 'Друго'],
];
export const WORK_CAT_LBL = Object.fromEntries(WORK_CATS) as Record<WorkCat, string>;
export const WORK_VERB_LBL: Record<WorkVerb, string> = { c: 'Креирано', u: 'Изменето', d: 'Избришано' };

/**
 * [category, verb, space-separated actions]. Built from every `audit({ action })` in apps/web and packages/db
 * (literal actions, ternaries, `auditAction` of `postJournal`, and the helpers that take the action as a parameter).
 */
const TABLE: readonly (readonly [WorkCat, WorkVerb, string])[] = [
  ['izlez', 'c', 'saveInv ordInv invProd recNew recImport recRun rbSave sendMailGo'],
  ['izlez', 'u', 'editInv recSave recItem'],
  ['izlez', 'd', 'delDoc bulkDelete recX cancelDoc'],
  ['vlez', 'c', 'savePur createMissingItems'],
  ['vlez', 'u', 'editPur ksMerge purNoDed scrSave'],
  ['vlez', 'd', 'delPur scrDel'],
  ['nalozi', 'c', 'saveJ postJournal impJournal kamNote posFee kompSave lnCreateSel newNalog'],
  ['nalozi', 'u', 'nalSave repostJournal nalOverride nalOverrideReset npSave schRepost lnSave'],
  ['nalozi', 'd', 'unpostJournal deleteJournal kompDel lnDel'],
  ['izvodi', 'c', 'importBank importReplace izvSave mbSave addRule pnRun ppSave trClose'],
  ['izvodi', 'u', 'bankKonto bankPartner bkPickSave autoMatch aiClassifyApply bkpFix feeFix flipBank izvFill numIzv unlinkBank lnLinkBank lnMisK ppPrint bankTransitMove bankRepostLayout bankAcctKonto'],
  ['izvodi', 'd', 'delBank delStatement undoImp rmRule ppDel'],
  ['blagajna', 'c', 'blgNew blgSetAdd'],
  ['blagajna', 'u', 'blgSave blgSetSave'],
  ['blagajna', 'd', 'blgDel blgSetRm'],
  ['plati', 'c', 'payNewM addEmpNow impEmployees hrRegister plxImp pbGo pbExcel pdMailGo mpinXml mpinXlsx pnSaveGo'],
  ['plati', 'u', 'savePay2 payLockM activateEmp ctSave diApply pdOeSave payParSave pnDone pnUndo mpinAck mpinEdit mpinFirm'],
  ['plati', 'd', 'payDelM unpostPayroll pnDel mpinDel mpinClear'],
  ['ddv', 'c', 'tuVatPost'],
  ['ddv', 'u', 'ddvClose ddvCorrections ddvReopen pddSave'],
  ['ddv', 'd', 'pddDel'],
  ['magacin', 'c', 'saveNivel nivMk runProd pcRun pnbRun posSell fkPost loySale mrpPo replMake rnPost impRun'],
  ['magacin', 'u', 'saveMove moSave prSave saveBom runUprosek lotSave lcSave akSave akcSave akStart akEnd ordSaveB poSaveB poRecv roPay'],
  ['magacin', 'd', 'delMove moDel prDel nivDel delProd fkDel lgDel rnDel akDel ordCancel poCancel'],
  ['magacin', 'c', 'poMail'],
  ['os', 'c', 'osImport osDoc osPhoto runDep'],
  ['os', 'u', 'saveAsset'],
  ['os', 'd', 'delAsset osFileDel'],
  ['firmi', 'c', 'newFirm fimpGo fsGo ncCreateFirm legacyImport legacyImportStart newS partnerNew addPartner addSupplier obMkP bkpMkP scanBuyer posEnsure accImport importAcc cbNew cbImport cbSeedCity paySifSeed fxImport bankAccountAuto addBankAcct'],
  ['firmi', 'u', 'saveFirm restoreFirm saveS actS tkSave savePartner autoCodes saveAcc resetAcc cbSave fxSave artMerge artUnitsGo bkGen anSave anImp artAbbrGo artFmt fuelItemsRate saveBankAcct'],
  ['firmi', 'd', 'delFirm delS slDel delAcc cbDelRow fxDel rmBankAcct'],
  ['dokumenti', 'c', 'fileUpload dosSave mzUpload recArchive paArch pkgBuild pkgMail pkgRep tplUse klSend klFoto lnAtt'],
  ['dokumenti', 'u', 'fileLink dosEdit dosMail tplSave fileMove'],
  ['dokumenti', 'd', 'fileUnlink dosDel pkgRm tplDel batchClear fileDelete'],
  ['ai', 'c', 'aiRead aiClassify scanStart scanDeep scanRetry scanIntoDraft fsRead mpinRead mpinReread pnScan lawAsk inspCodesScan'],
  ['ai', 'd', 'scanCancel scanRemove'],
  ['zatvoranje', 'c', 'carryOver closeYear saveOpen crmXmlImport zmImport zpArch zyAdd zyGen zyToPkg'],
  ['zatvoranje', 'u', 'carryRow lockYear firmUnlock zatLock bbAnK npoPlan tpSave zcAck zcUnack zsStatus zprSave prReset spSave dbSave vpSave zmSave zmClear deSave deReset belSave belReset crmPeriod'],
  ['zatvoranje', 'd', 'undoClose crmXClr zyDel'],
  ['dejnosti', 'c', 'apNew apInv apKasa htNew htAdv htFisc htInv htResImport htRoomImport rcNew rcInv rcFleetImport woNew woInv cvNew cvImport cpNew csInv pnNew pnCashPost pnRetCr pnMail pnVehImport frNew frInv frDocImport taNew tbNew tbAdv tbInv tbPay fleetImport potMail kcImport rtableSave rordSave cnoteSave frdocSave frfuelSave'],
  ['dejnosti', 'u', 'apSave apRem apStatus htSave htCharges htClean htGuests htIn htOut htNoShow htRoomSave rcSave rcOut rcRet rcDepIn rcDepBack woSaveB cvSave cpSave csSave cdSave pcLink pnSaveB pnDep pnDeliv pnRet pnSvcDone frSave frQuickSave frDocSave taSave tbSave fleetSave potDone kcSave entSave'],
  ['dejnosti', 'd', 'apCancel htCancel rcCancel woDel pcUnlink pnlDel frDel frDocDel tbCancel tbPayRm kcDel rtableDel rordDel cnoteDel frdocDel frfuelDel'],
  ['kanc', 'c', 'tNew ncNew ncTask kdUpSigned kdRepMail kdMail klAddRec klAutoUser klMsg klNotePdf alMail apSendOne amlGo amlRepNew amlTrAdd opLog paSend lrPdf inspAtt inspCodeAdd zzIzjUp'],
  ['kanc', 'u', 'tSave tSt ncSave kdSaveB kdCliSign kdOffSign kdEnd kdToDos kdRecSync klAppr klRej klPwReset klRenameNum ainbDone irGo irArch alAck alUnack apRun apSkip amlSave amlRepSt amlCtl dlSave dlDone fcSave formSaveEmbg inspNa inspOk zzSave zzClose zzSigned zzIzjSign'],
  ['kanc', 'd', 'tDel kdDel fcDel lawDel inspCodeRm'],
  // AML / УФР, inspections (kontroli), data protection (ROPA, data-subject requests)
  ['kanc', 'c', 'amlUfrNew amlScan kontrolaNew kontrolaFindingNew kontrolaActionNew kontrolaAiApply kontrolaDraft dsrNew ropaSeed'],
  ['kanc', 'u', 'amlDecide amlUfrSave amlUfrSubmit kontrolaEdit kontrolaRecalc kontrolaFindingEdit kontrolaActionEdit kontrolaActionDone ropaSave dsrClose'],
  ['kanc', 'd', 'amlPurge kontrolaDel kontrolaFindingDel kontrolaActionDel'],
  // monthly client report („📊 Месечен извештај за клиентот“)
  ['kanc', 'c', 'crPrep crAi crMail frAi'],
  ['kanc', 'u', 'crPublish crHide klLang'],
  // inspection documents / AI legal analysis, legal assistant, deadlines calendar, fee invoices
  ['kanc', 'c', 'kontrolaDocAuto kontrolaAiStart lawCase lawCaseAttach feeIssue feeRemind'],
  ['kanc', 'u', 'kontrolaFindingMark kontrolaSubType kontrolaVersionAccept kontrolaVersionDiscard rokDone rokOpen lawCaseDetach lawTextLink lawTextPaste'],
  ['kanc', 'd', 'lawCaseDel'],
  ['ai', 'c', 'kontrolaAi'],
  ['izvodi', 'c', 'ppBatch bankBookAll'],
  ['firmi', 'c', 'partnerAccLearn fxNbrm'],
  ['firmi', 'u', 'partnerAccSave'],
  ['magacin', 'c', 'fiskrNew fiskrReport'],
  ['magacin', 'u', 'fiskrOk fiskrFail'],
  ['magacin', 'd', 'delTransfer'],
];

/** Not work: sign-in, settings / configuration, downloads and renders, system jobs, user administration. */
const NOISE = new Set((
  'login logout loginFail loginLocked loginUnlock uMyPass uNew uSave uDel ownerSet bookOnlySet userViewsSet aiBudgetSet deviceNew deviceRevoke deviceInstaller miClaim klPrevOn klPrevOff pdfRender ublDl pkgZip pnLivePos lawSeenAll lawRobotRun lawTextsSync rokSync rokSettings feeSettings feeDeliver recOff carryStatPrefixes cascade '
  + 'backupJson bkNow bkRestoreGo errFix errDelFixed legacyImportSettings legacyImportUser legacyImportJournal '
  + 'invStyle crMode svcOnly dtSaveCols opSet apCfg bankFmt msSave msReset industryCfgSave modSave autoCfgSave klImgUp klImgRm '
  + 'kdOffSave zzSaveOff hrPrefix pddTypesSave ppCal schSaveAll schReset schSave custDel carryByDoc defMargin saveNalCodes '
  + 'ddvPerKind trSave efSet lnIgnore inspProf klOnlyBase klProf klSave tplOff autoNotify bankKontaSet offFirmSet amlOffSet mpinTplImport '
  + 'demoUserSet demoSeed demoReset demoLinkNew demoLinkRevoke demoLinkOpen demoAiSet demoRefused '
  + 'akRaw artAbbrSave artIgn devDel dfiOpt lotDays loyCfgSave pcCfgSave replCfg rnPct convPreset aiSwitch aiPing viewPersonal '
  // literals picked up from `action:` keys that are not audit actions (status words of other objects)
  + 'na photo mail cancel reminded dep deliv approve pct posted mrp recv action pos'
).split(' '));

/**
 * Journals posted as the by-product of a document that has its own audit row: not a separate movement
 * (their lines still count in the volume).
 */
const BY_PRODUCT = new Set(['postInvoice', 'postPurchase', 'postStatement', 'postCashVoucher', 'postCompensation', 'postSupplierCredit',
  'postPayroll', 'repostPayroll', 'postMpinAck', 'nalOverrideRepost', 'ddvPost', 'pddPost']);
/** Same rule as the journals screen (`fromDocument`): these sources are entered by hand, not from a document. */
const MANUAL_SOURCES = new Set(['opening', 'bbimp', 'yearClose']);
const GENERIC_JOURNAL = new Set(['postJournal', 'repostJournal', 'unpostJournal', 'deleteJournal']);

/** Actions whose category depends on the entity (`approveDoc` approves an invoice or a purchase). */
const BY_ENTITY = new Set(['approveDoc']);

/** Category when the action is not in the table: by the audited entity type. */
const ENTITY_CAT: Record<string, WorkCat> = {
  invoice: 'izlez', recurring_invoice: 'izlez',
  purchase: 'vlez', supplier_credit: 'vlez',
  journal: 'nalozi', loan: 'nalozi',
  bank_line: 'izvodi', bank_lines: 'izvodi', bank_statement: 'izvodi', bank_import: 'izvodi', bank_rule: 'izvodi', payment_order: 'izvodi',
  cash_voucher: 'blagajna', cash_register: 'blagajna',
  payroll_run: 'plati', payroll_note: 'plati', payroll_params: 'plati', payroll_settings: 'plati', employee: 'plati', hr_doc: 'plati', mpin_inbox: 'plati', mpin_ack: 'plati',
  vatPeriod: 'ddv', pdd_payment: 'ddv', travel_vat: 'ddv',
  stock_move: 'magacin', stock_count: 'magacin', store_out: 'magacin', transfer: 'magacin', levelling: 'magacin', production: 'magacin', bom: 'magacin',
  sales_daily: 'magacin', writeoff_doc: 'magacin', supplier_order: 'magacin', customer_order: 'magacin', promotion: 'magacin', loyalty_card: 'magacin', stock_lot: 'magacin', stock: 'magacin',
  asset: 'os',
  firm: 'firmi', partner: 'firmi', item: 'firmi', account: 'firmi', fx_rates: 'firmi', bank_account: 'firmi',
  file: 'dokumenti', dossier_doc: 'dokumenti', doc_package: 'dokumenti', word_template: 'dokumenti', request_template: 'dokumenti',
  ai_document: 'ai', firm_resh_read: 'ai',
  annualStatement: 'zatvoranje', year: 'zatvoranje',
  appointment: 'dejnosti', hotel_reservation: 'dejnosti', hotel_room: 'dejnosti', rent_rental: 'dejnosti', work_order: 'dejnosti',
  customer_vehicle: 'dejnosti', construction_project: 'dejnosti', construction_situation: 'dejnosti', construction_diary: 'dejnosti',
  travel_order: 'dejnosti', freight_tour: 'dejnosti', travel_arrangement: 'dejnosti', travel_booking: 'dejnosti', fleet_vehicle: 'dejnosti', firm_doc: 'dejnosti',
  office_task: 'kanc', formation_case: 'kanc', service_contract: 'kanc', client_entry: 'kanc', inbox_item: 'kanc', firm_deadline: 'kanc', firm_contact: 'kanc',
  inspection: 'kanc', gdpr_record: 'kanc', aml_record: 'kanc', aml_report: 'kanc', autopilot_finding: 'kanc', autopilot_message: 'kanc', dunning_letter: 'kanc', potvrda: 'kanc',
};
/** `action@entityType` exceptions (the same action name used for something else). */
const PAIR: Record<string, readonly [WorkCat, WorkVerb] | null> = {
  'fkPost@firm': null, // `patchFirmSettings(…, 'fkPost')`: a firm setting, not a daily sales posting
  'cpSave@coupon': ['magacin', 'u'],
};

const MAP = new Map<string, readonly [WorkCat, WorkVerb]>();
for (const [cat, verb, s] of TABLE) for (const a of s.split(' ')) if (a) MAP.set(a, [cat, verb]);

/** Verb guessed from the action name (actions not in the table). */
export function verbOf(action: string): WorkVerb {
  if (/(del|rm|remove|cancel|clear|unpost|undo|unlink)/i.test(action)) return 'd';
  if (/(new|add|create|import|imp|mk|gen|upload|^post|run|go$)/i.test(action)) return 'c';
  return 'u';
}

export interface Classified {
  cat: WorkCat;
  verb: WorkVerb;
  /** false: the action is not in the table (category from the entity type or „Друго“) — listed on the screen. */
  known: boolean;
  /** A journal posted for a document: no movement of its own, only volume. */
  byProduct: boolean;
}

/** Classify one audit row; `null` = not work (sign-in, settings, downloads, system). */
export function classifyAction(action: string, entityType?: string | null, data?: Record<string, unknown> | null): Classified | null {
  const pair = PAIR[`${action}@${entityType ?? ''}`];
  if (pair !== undefined) return pair && { cat: pair[0], verb: pair[1], known: true, byProduct: false };
  if (NOISE.has(action)) return null;
  if (BY_PRODUCT.has(action)) return { cat: 'nalozi', verb: verbOf(action), known: true, byProduct: true };
  if (GENERIC_JOURNAL.has(action)) {
    const src = typeof data?.sourceType === 'string' ? data.sourceType : '';
    const m = MAP.get(action)!;
    return { cat: m[0], verb: m[1], known: true, byProduct: !!src && !MANUAL_SOURCES.has(src) };
  }
  const m = MAP.get(action);
  if (m) return { cat: m[0], verb: m[1], known: true, byProduct: false };
  const byEnt = entityType ? ENTITY_CAT[entityType] ?? (entityType.startsWith('code:') ? 'firmi' : undefined) : undefined;
  if (BY_ENTITY.has(action)) return { cat: byEnt ?? 'drugo', verb: 'u', known: true, byProduct: false };
  return { cat: byEnt ?? 'drugo', verb: verbOf(action), known: false, byProduct: false };
}

/** Every action in the classification table (known work + noise + by-products), for the coverage test. */
export const KNOWN_ACTIONS: ReadonlySet<string> = new Set([...MAP.keys(), ...NOISE, ...BY_PRODUCT, ...BY_ENTITY]);

/* ------------------------------------------------------------------ active time */

/** A pause longer than this ends a burst of work. */
export const BURST_GAP_MIN = 15;
/** Every burst counts at least this much (one action takes about a minute). */
export const BURST_MIN_MIN = 1;

/**
 * Estimated active time in minutes: the movements are split into bursts wherever the pause is ≥ 15 minutes; each
 * burst counts from its first to its last movement, plus one minute.
 */
export function activeMinutes(times: readonly number[], gapMin = BURST_GAP_MIN, minPerBurst = BURST_MIN_MIN): number {
  if (!times.length) return 0;
  const t = [...times].sort((a, b) => a - b);
  let total = 0, start = t[0]!, prev = t[0]!;
  for (const x of t.slice(1)) {
    if (x - prev >= gapMin * 60_000) { total += (prev - start) / 60_000 + minPerBurst; start = x; }
    prev = x;
  }
  total += (prev - start) / 60_000 + minPerBurst;
  return Math.round(total);
}

/** Movements per active hour (one decimal), `null` without active time. */
export const perActiveHour = (n: number, minutes: number): number | null => (minutes > 0 ? Math.round((n * 600) / minutes) / 10 : null);

/** „3 ч 05 мин“ */
export const fmtMinutes = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин` : `${m} мин`);

/* ------------------------------------------------------------------ period */

export type PeriodPreset = 'd' | 'w' | 'm' | 'pm' | 'y';
export const PERIOD_PRESETS: readonly (readonly [PeriodPreset, string])[] = [
  ['d', 'Денес'], ['w', 'Оваа недела'], ['m', 'Овој месец'], ['pm', 'Минат месец'], ['y', 'Година'],
];

/** Date range (inclusive, `YYYY-MM-DD`) of a preset, relative to `today` (Skopje). The week starts on Monday. */
export function presetRange(p: PeriodPreset, today: string): { from: string; to: string } {
  if (p === 'd') return { from: today, to: today };
  if (p === 'w') {
    const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    return { from: addDays(today, -dow), to: today };
  }
  if (p === 'm') return { from: today.slice(0, 8) + '01', to: today };
  if (p === 'pm') {
    const first = today.slice(0, 8) + '01';
    const last = addDays(first, -1);
    return { from: last.slice(0, 8) + '01', to: last };
  }
  return { from: today.slice(0, 4) + '-01-01', to: today };
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/**
 * The period from the query: a preset (`p`), or Од / До (`od`, `do`); default this month. A reversed range is
 * swapped; at most 400 days.
 */
export function parsePeriod(q: { p?: string | null; od?: string | null; do?: string | null }, today: string): { from: string; to: string; preset: PeriodPreset | '' } {
  const od = q.od && DATE_RE.test(q.od) ? q.od : '', dd = q.do && DATE_RE.test(q.do) ? q.do : '';
  if (od || dd) {
    let from = od || dd, to = dd || od;
    if (from > to) [from, to] = [to, from];
    if (from < addDays(to, -400)) from = addDays(to, -400);
    return { from, to, preset: '' };
  }
  const p = PERIOD_PRESETS.some(([k]) => k === q.p) ? (q.p as PeriodPreset) : 'm';
  return { ...presetRange(p, today), preset: p };
}

/** The instant a Skopje calendar day starts (CET / CEST midnight), for exact `at >= …` bounds. */
export function skopjeDayStart(day: string): Date {
  const z = Date.parse(`${day}T00:00:00Z`);
  for (const h of [2, 1, 0]) {
    const t = z - h * 36e5;
    if (todaySkopje(new Date(t)) === day && todaySkopje(new Date(t - 1)) !== day) return new Date(t);
  }
  return new Date(z - 36e5);
}

/** Every day from `from` to `to` inclusive. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/* ------------------------------------------------------------------ aggregation */

export interface AuditRowIn {
  at: Date;
  userId: string | null;
  firmId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  data: Record<string, unknown> | null;
}

type VerbCount = Record<WorkVerb, number>;
const zv = (): VerbCount => ({ c: 0, u: 0, d: 0 });

export interface WorkVolume {
  /** Lines of every journal posted / re-posted (by hand or from a document). */
  jLines: number;
  /** Journals entered by hand (not from a document). */
  journals: number;
  /** Bank lines imported (statement files). */
  bankImported: number;
  /** Bank lines booked / matched by hand or with „автоматско поврзување“. */
  bankBooked: number;
  /** Distinct outgoing invoices saved, and their totals (MKD, last saved total), in cents. */
  inv: number; invCents: number;
  /** Distinct purchases saved, and their totals (MKD), in cents. */
  pur: number; purCents: number;
}
const zvol = (): WorkVolume => ({ jLines: 0, journals: 0, bankImported: 0, bankBooked: 0, inv: 0, invCents: 0, pur: 0, purCents: 0 });

export interface FirmWork { firmId: string | null; total: number; byCat: Partial<Record<WorkCat, number>> }

export interface UserWork {
  userId: string | null;
  /** Movements (work audit rows, without by-products). */
  total: number;
  verbs: VerbCount;
  byCat: Partial<Record<WorkCat, VerbCount>>;
  firms: FirmWork[];
  /** Movements per Skopje day. */
  days: Record<string, number>;
  activeDays: number;
  activeMin: number;
  perHour: number | null;
  vol: WorkVolume;
  /** Rows left out as not work (sign-in, settings…). */
  noise: number;
  first: Date | null;
  last: Date | null;
}

export interface ProductivityReport {
  users: UserWork[];
  /** Actions not in the table → their count (category from the entity type or „Друго“). */
  unknown: Record<string, number>;
  total: number;
}

const toCents = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const isMkd = (c: unknown) => c == null || c === '' || c === 'MKD';

/** Aggregate audit rows per user. Rows outside [from, to] (Skopje days) are ignored. */
export function aggregateProductivity(rows: readonly AuditRowIn[], range?: { from: string; to: string }): ProductivityReport {
  const U = new Map<string, {
    w: UserWork; times: number[]; firms: Map<string, FirmWork>;
    inv: Map<string, [number, number | null]>; pur: Map<string, [number, number | null]>;
  }>();
  const unknown: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const day = todaySkopje(r.at);
    if (range && (day < range.from || day > range.to)) continue;
    const key = r.userId ?? '';
    let x = U.get(key);
    if (!x) {
      x = { w: { userId: r.userId, total: 0, verbs: zv(), byCat: {}, firms: [], days: {}, activeDays: 0, activeMin: 0, perHour: null, vol: zvol(), noise: 0, first: null, last: null },
        times: [], firms: new Map(), inv: new Map(), pur: new Map() };
      U.set(key, x);
    }
    const c = classifyAction(r.action, r.entityType, r.data);
    if (!c) { x.w.noise++; continue; }
    const d = r.data ?? {};
    // volume
    if (r.entityType === 'journal' && !/^(unpost|delete)/.test(r.action) && typeof d.lines === 'number') x.w.vol.jLines += d.lines;
    if (r.action === 'importBank' && typeof d.lines === 'number') x.w.vol.bankImported += d.lines;
    if (['bankKonto', 'bankPartner', 'bkPickSave', 'mbSave', 'bkpFix', 'aiClassifyApply'].includes(r.action)) x.w.vol.bankBooked++;
    if (r.action === 'autoMatch' && Array.isArray(d.lines)) x.w.vol.bankBooked += d.lines.length;
    // the last saved total of each document (rows may come in any order)
    const keep = (M: Map<string, [number, number | null]>, id: string, v: number | null) => { const p = M.get(id); if (!p || p[0] <= r.at.getTime()) M.set(id, [r.at.getTime(), v]); };
    if ((r.action === 'saveInv' || r.action === 'editInv') && r.entityId && (d.kind == null || d.kind === 'invoice')) keep(x.inv, r.entityId, isMkd(d.currency) ? toCents(d.total) : null);
    if ((r.action === 'savePur' || r.action === 'editPur') && r.entityId) keep(x.pur, r.entityId, toCents(d.total));
    if (c.byProduct) continue;
    if (c.cat === 'nalozi' && r.entityType === 'journal' && c.verb === 'c') x.w.vol.journals++;
    if (!c.known) unknown[r.action] = (unknown[r.action] ?? 0) + 1;
    total++;
    x.w.total++;
    x.w.verbs[c.verb]++;
    (x.w.byCat[c.cat] ??= zv())[c.verb]++;
    const fk = r.firmId ?? '';
    let f = x.firms.get(fk);
    if (!f) { f = { firmId: r.firmId, total: 0, byCat: {} }; x.firms.set(fk, f); }
    f.total++;
    f.byCat[c.cat] = (f.byCat[c.cat] ?? 0) + 1;
    x.w.days[day] = (x.w.days[day] ?? 0) + 1;
    x.times.push(r.at.getTime());
    if (!x.w.first || r.at < x.w.first) x.w.first = r.at;
    if (!x.w.last || r.at > x.w.last) x.w.last = r.at;
  }
  const users: UserWork[] = [];
  for (const x of U.values()) {
    const w = x.w;
    w.firms = [...x.firms.values()].sort((a, b) => b.total - a.total);
    w.activeDays = Object.keys(w.days).length;
    w.activeMin = activeMinutes(x.times);
    w.perHour = perActiveHour(w.total, w.activeMin);
    w.vol.inv = x.inv.size;
    w.vol.invCents = [...x.inv.values()].reduce<number>((a, [, v]) => a + (v ?? 0), 0);
    w.vol.pur = x.pur.size;
    w.vol.purCents = [...x.pur.values()].reduce<number>((a, [, v]) => a + (v ?? 0), 0);
    users.push(w);
  }
  users.sort((a, b) => b.total - a.total || b.noise - a.noise);
  return { users, unknown, total };
}

/** Firms a user worked on (with at least one movement). */
export const firmCount = (w: UserWork): number => w.firms.filter((f) => f.firmId).length;
/** Movements of a user in a category (all verbs). */
export const catTotal = (w: UserWork, cat: WorkCat): number => { const v = w.byCat[cat]; return v ? v.c + v.u + v.d : 0; };
