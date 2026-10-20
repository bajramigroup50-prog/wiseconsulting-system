/**
 * The people side of the office's ISO system (ISO/IEC 27001:2022 A.6, A.5.10–5.11, A.5.15–5.18, ЗЗЛП чл. 36):
 * the articles built into the office's own employment contracts, the ethics / independence clause (IESBA – the ISQM
 * module may supply its own wording through `IESBA_CONTRACT_CLAUSE`), the statement of accepting the policies, and the
 * per-employee readiness row. Pure.
 */
import type { IsoRow } from './iso';

/** Ethics and independence (IESBA Code, Закон за ревизија / сметководители): a standard clause of the contract. */
export const IESBA_CONTRACT_CLAUSE = 'Работникот се обврзува да ги почитува основните начела на Етичкиот кодекс за професионални сметководители (IESBA) – интегритет, објективност, професионална компетентност и должно внимание, доверливост и професионално однесување – и правилата на работодавачот за независност и судир на интереси: да не врши услуги за клиентите на работодавачот во свое име или за друг, да не прима подароци и погодности што може да влијаат на неговата објективност, и веднаш писмено да го извести работодавачот за секој личен, финансиски или семеен однос со клиент што може да претставува судир на интереси. Работникот еднаш годишно потпишува изјава за независност и етика.';

/** One article: a heading and its text (plain; the renderer escapes it). */
export interface ContractArticle { t: string; p: string }

/**
 * The articles of ISO/IEC 27001 A.6 and ЗЗЛП in an employment contract with the office (the contract is the office's
 * own, so they are part of it, not an annex): confidentiality also after termination, information security,
 * the authorised person under ЗЗЛП, acceptable use and return of assets, incident reporting, policies and trainings,
 * ethics and independence, disciplinary measures.
 */
export function isoContractArticles(iesba = IESBA_CONTRACT_CLAUSE): ContractArticle[] {
  return [
    { t: 'Доверливост', p: 'Работникот е должен како деловна тајна да ги чува сите информации за работодавачот и за неговите клиенти до кои ќе дојде во текот на работата – деловни книги, финансиски и даночни податоци, податоци за вработените на клиентите, лозинки и пристапни податоци, цени и договори – и да не ги открива, копира, користи за свои цели или за трети лица. Обврската за доверливост трае и по престанокот на работниот однос, без временско ограничување за личните податоци и деловните тајни на клиентите (ISO/IEC 27001 A.6.6, A.6.5).' },
    { t: 'Безбедност на информациите', p: 'Работникот е должен да ги почитува политиките и постапките за безбедност на информациите на работодавачот (ISO/IEC 27001): да користи само сопствено корисничко име и лозинка и да не ги споделува, да го заклучува екранот кога не е на работното место, да не ги остава документите на клиентите на видно место, да праќа документи само на проверени адреси на клиентите и да не ги пренесува податоците на клиентите на лични уреди, преносни медиуми или лични облак-сервиси.' },
    { t: 'Овластено лице за обработка на лични податоци', p: 'Со склучувањето на овој договор работникот се овластува да обработува лични податоци во рамките на своите работни задачи, во согласност со Законот за заштита на личните податоци, како овластено лице на работодавачот – кога работодавачот е контролор, и кога ги обработува податоците по налог на клиентите како обработувач. Работникот обработува лични податоци само по упатствата на работодавачот, само колку што е потребно за работата, ги применува техничките и организациските мерки за безбедност и не смее да ги открива на неовластени лица. Работникот е запознаен дека повредата на оваа обврска може да предизвика прекршочна и кривична одговорност.' },
    { t: 'Употреба и враќање на средствата', p: 'Информатичката опрема, програмата, е-поштата и другите средства на работодавачот работникот ги користи само за работа, во согласност со Политиката за прифатлива употреба (ISO/IEC 27001 A.5.10). Задолжените средства (лаптоп, телефон, клучеви, токени, документи) работникот е должен да ги врати најдоцна на денот на престанокот на работниот однос или на барање на работодавачот, без да задржи копии од податоците (A.5.11). Пристапот на работникот до програмата и системите се затвора на денот на престанокот.' },
    { t: 'Пријавување безбедносни настани', p: 'Работникот е должен веднаш, без одлагање, да го извести одговорното лице на работодавачот за секој безбедносен настан или слабост – изгубен или украден уред, документ испратен на погрешна адреса, сомнителна порака или најава, неовластен пристап, вирус – за да може работодавачот да постапи во законскиот рок од 72 часа за известување на Агенцијата за заштита на личните податоци (ISO/IEC 27001 A.6.8).' },
    { t: 'Политики и обуки', p: 'Работникот е должен да се запознае и да ги почитува политиките и постапките на системот за управување со квалитет, безбедност на информациите, заштита на личните податоци и континуитет на работењето (ISO 9001, ISO/IEC 27001, ISO/IEC 27701, ISO 22301) што се во сила кај работодавачот, што го потврдува со потпишување изјава за прифаќање на политиките – и при секоја нивна измена – како и да присуствува на обуките што ги организира работодавачот, најмалку еднаш годишно (ISO/IEC 27001 A.6.3).' },
    { t: 'Етика и независност', p: iesba },
    { t: 'Дисциплински мерки', p: 'Повредата на обврските од членовите за доверливост, безбедност на информациите, заштита на личните податоци, употреба и враќање на средствата и пријавување безбедносни настани претставува повреда на работниот ред и дисциплина, односно на работните обврски, за која работодавачот може да изрече дисциплинска мерка или да го откаже договорот во согласност со Законот за работните односи, по претходно утврдување на фактите и можност работникот да се изјасни (ISO/IEC 27001 A.6.4). Со тоа не се исклучува одговорноста за надомест на штета.' },
  ];
}

/** General collective agreement for the private sector (ЗРО чл. 28 – the reference in the contract). */
export const HR_CBA_DEFAULT = 'Општиот колективен договор за приватниот сектор од областа на стопанството („Службен весник на Република Македонија“ бр. 115/2014, со измените)';
/** The usual working schedule of an office. */
export const HR_SCHEDULE_DEFAULT = 'од понеделник до петок, од 08:00 до 16:00 часот, со дневен одмор од 30 минути';

/** A policy in force for the statement (`docNo` and `version` from „Политики и документи“). */
export interface PolicyInForce { docNo: string; version: string; title: string; approvedOn: string | null }
/** „ПЛ-01 в1.0; ПС-04 в1.1“ – what an employee accepted (kept on the staff row). */
export const ackString = (P: readonly PolicyInForce[]) => P.map((p) => `${p.docNo} в${p.version}`).join('; ');
/** The policies whose current version is not in the accepted list. */
export function ackMissing(P: readonly PolicyInForce[], acked: string): PolicyInForce[] {
  const have = new Set(String(acked ?? '').split(/;\s*/).map((x) => x.trim()).filter(Boolean));
  return P.filter((p) => !have.has(`${p.docNo} в${p.version}`));
}

/** The policies in force: approved documents with a mark, by mark. */
export function policiesInForce(R: readonly IsoRow[]): PolicyInForce[] {
  return R.filter((r) => r.kind === 'policy' && r.data.docNo && r.data.approvedOn && r.status === 'done')
    .map((r) => ({ docNo: String(r.data.docNo), version: String(r.data.version ?? '1.0'), title: r.title, approvedOn: String(r.data.approvedOn) }))
    .sort((a, b) => a.docNo.localeCompare(b.docNo, 'mk'));
}

export type StaffCheck = 'ok' | 'part' | 'miss' | 'na';
export interface StaffInput {
  emp: { id: string; name: string; active: boolean; start: string | null; end: string | null };
  user: { id: string; active: boolean; role: string } | null;
  row: IsoRow | null;
  /** The current registered employment contract (with the ISO articles or not). */
  contract: { no: string; signDate: string | null; iso: boolean } | null;
  /** Files attached to the staff row (the signed scan). */
  files: number;
  /** The ЗЗЛП confidentiality statement of the user (/korisnici). */
  izj: { signed?: boolean; at?: string } | null;
  policies: readonly PolicyInForce[];
  trainings: readonly IsoRow[];
  today: string;
}
export interface StaffStatus { contract: StaffCheck; confid: StaffCheck; policies: StaffCheck; training: StaffCheck; access: StaffCheck; ok: boolean; notes: string[]; missing: PolicyInForce[]; trainedOn: string | null; hours: number }

/** The readiness row of one employee (A.6.1–6.6, A.5.11, A.5.15–5.18). */
export function staffStatus(x: StaffInput): StaffStatus {
  const d = x.row?.data ?? {}, notes: string[] = [];
  const contract: StaffCheck = d.contractOn && x.files > 0 && x.contract?.iso ? 'ok' : d.contractOn || x.contract ? 'part' : 'miss';
  if (!x.contract) notes.push('договорот не е заведен во програмата');
  else if (!x.contract.iso) notes.push('договорот нема одредби за безбедност и ЗЗЛП – нов договор');
  if (!d.contractOn) notes.push('договорот не е означен како потпишан');
  else if (!x.files) notes.push('не е прикачен скенираниот потпишан договор');
  const confid: StaffCheck = x.izj?.signed || (d.contractOn && x.contract?.iso) ? 'ok' : 'miss';
  const missing = ackMissing(x.policies, String(d.ackDocs ?? ''));
  const policies: StaffCheck = !x.policies.length || !d.ackOn ? 'miss' : missing.length ? 'part' : 'ok';
  if (!x.policies.length) notes.push('нема документи во сила за прифаќање');
  if (policies === 'part') notes.push(`политики со нова верзија: ${missing.map((p) => p.docNo).join(', ')}`);
  const nm = x.emp.name.trim().toLowerCase();
  const T = x.trainings.filter((t) => String(t.data.who ?? '').toLowerCase().includes(nm) || String(t.data.who ?? '').toLowerCase().includes('сите'));
  const dates = T.map((t) => String(t.data.date ?? t.created.slice(0, 10))).sort();
  const trainedOn = dates.at(-1) ?? null;
  const yearAgo = `${Number(x.today.slice(0, 4)) - 1}${x.today.slice(4, 10)}`;
  const training: StaffCheck = trainedOn && trainedOn >= yearAgo ? 'ok' : trainedOn ? 'part' : 'miss';
  if (training === 'part') notes.push('последната обука е постара од 12 месеци');
  let access: StaffCheck;
  if (x.emp.active) access = x.user ? (x.user.active ? 'ok' : 'part') : 'na';
  else {
    const off = !x.user || !x.user.active;
    access = off && d.assetsBack === 'да' && d.accessOffOn ? 'ok' : off ? 'part' : 'miss';
    if (!off) notes.push('работникот заминал, а корисникот е уште активен');
    if (d.assetsBack !== 'да') notes.push('средствата не се означени како вратени');
  }
  const L = [contract, confid, policies, training, access];
  return { contract, confid, policies, training, access, ok: L.every((c) => c === 'ok' || c === 'na'), notes, missing, trainedOn, hours: T.reduce((s, t) => s + (Number(t.data.hours) || 0), 0) };
}
