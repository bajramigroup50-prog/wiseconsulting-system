/**
 * IFAC – readiness of the office for an ИСОС quality-control review (the office is not certified yet; the goal is to
 * be ready): the ISQM 1 system of quality management (its nine components, each documented with an owner, sign-off,
 * evidence and version), the people (competence per role, the continuing professional development of licensed
 * accountants – IES 7), the ISRS 4410 engagement file and the compiler's report, and the readiness status that
 * gathers all of it. Pure – storage in @wise/db `ifac_records` (`sqm_<component>` rows of the office, `staff` rows per
 * employee and year); the per-firm letter / checklist and the declarations are in `./ifac`.
 */
import type { Role } from '../rbac';
import { elFileNormalize, elFileStatus, qcReviewed, type ElFile, type ElLetter, type QcData } from './ifac';
import type { KdFirm, KdOffice } from '../firms/kdog';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dmy = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');
const isDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const str = (v: unknown, max = 4000) => String(v ?? '').trim().slice(0, max);

/** `subject` of the office's own rows (the ISQM 1 components). */
export const OFFICE_SUBJECT = '00000000-0000-0000-0000-000000000000';
/** `file_links.entity_type` of the evidence attached to an IFAC record. */
export const IFAC_FILE_ENTITY = 'ifac_record';

/** Who / when / version kept on every saved form (`data._v`, `_by`, `_at`). */
export interface FormMeta { _v?: number; _by?: string | null; _at?: string | null }
export const formMeta = (d: Record<string, unknown> | null | undefined): { v: number; by: string | null; at: string | null } =>
  ({ v: Number(d?._v) || 0, by: typeof d?._by === 'string' ? d._by : null, at: typeof d?._at === 'string' ? d._at : null });

/* ================= ISQM 1 – the nine components ================= */

export interface SqmField { k: string; n: string; t?: 'area' | 'text' | 'date' | 'sel'; o?: readonly string[]; req?: boolean; ph?: string }
export interface SqmComp { k: string; n: string; clause: string; ic: string; hint: string; fields: readonly SqmField[]; evidence: boolean }

/** ISQM 1 components (§23–§54); `req` fields must be filled for the component to count as documented. */
export const SQM_COMPONENTS: readonly SqmComp[] = [
  {
    k: 'risk', n: 'Процес на проценка на ризиците на фирмата', clause: 'ISQM 1 §23–27', ic: '🎯', evidence: false,
    hint: 'Цели на квалитетот за секоја компонента, ризиците што ги загрозуваат (веројатност и влијание) и одговорите. Се ревидира најмалку еднаш годишно и при промена (нов вработен, нов вид клиенти, законска измена).',
    fields: [
      { k: 'objectives', n: 'Цели на квалитетот (по компонента)', t: 'area', req: true, ph: 'пр. Сите пријави на клиентите се поднесуваат во законски рок; секоја годишна сметка ја прегледува второ лице…' },
      { k: 'risks', n: 'Ризици по квалитетот (што може да тргне наопаку, зошто)', t: 'area', req: true, ph: 'пр. пропуштен рок поради отсуство; недоставени документи; грешка во даночен биланс…' },
      { k: 'responses', n: 'Одговори (политики и постапки за секој ризик)', t: 'area', req: true },
      { k: 'reviewed', n: 'Последна ревизија на проценката', t: 'date', req: true },
    ],
  },
  {
    k: 'gov', n: 'Управување и лидерство', clause: 'ISQM 1 §28, §20', ic: '🏛', evidence: false,
    hint: 'Кој има крајна одговорност за системот, кој оперативна, кој за независноста и етиката, и посветеноста на квалитетот (култура, одлуки за ресурси, оценување на вработените и по квалитет).',
    fields: [
      { k: 'ultimate', n: 'Крајна одговорност за системот (управител)', req: true }, { k: 'operational', n: 'Оперативна одговорност за системот', req: true },
      { k: 'indep', n: 'Одговорен за независност и етика', req: true }, { k: 'monitorResp', n: 'Одговорен за следење и отстранување', req: true },
      { k: 'culture', n: 'Посветеност на квалитетот (како се покажува, како се оценуваат вработените)', t: 'area', req: true },
    ],
  },
  {
    k: 'ethics', n: 'Релевантни етички барања', clause: 'ISQM 1 §29 · IESBA', ic: '🧭', evidence: false,
    hint: 'Политика за независност и судир на интереси, годишните изјави (во „Вработени“), евиденција на прекршувања и нивно решавање, подароци и гостопримство.',
    fields: [
      { k: 'policy', n: 'Политика за етика, независност и судир на интереси', t: 'area', req: true },
      { k: 'breaches', n: 'Евиденција на прекршувања / судири и како се решени', t: 'area', ph: 'нема евидентирани' },
      { k: 'gifts', n: 'Правило за подароци и гостопримство', t: 'area', req: true },
    ],
  },
  {
    k: 'accept', n: 'Прифаќање и продолжување на клиенти', clause: 'ISQM 1 §30', ic: '🤝', evidence: false,
    hint: 'Постапката е листата ISQM 1 по фирма и година (интегритет, УФР, ризик, компетентност, независност, договор и писмо); тука се опишува и кој одлучува.',
    fields: [{ k: 'procedure', n: 'Постапка за прифаќање / продолжување и кој одлучува', t: 'area', req: true }, { k: 'declineRule', n: 'Кога се одбива или прекинува ангажман', t: 'area', req: true }],
  },
  {
    k: 'perf', n: 'Изведување на ангажманите', clause: 'ISQM 1 §31', ic: '⚙', evidence: false,
    hint: 'Методологија (контролни листи во WISE), насочување, надзор и преглед, консултации за сложени прашања, разлики во мислењата, комплетирање и чување на досието на ангажманот.',
    fields: [
      { k: 'method', n: 'Методологија и алатки (контроли, листи, шаблони)', t: 'area', req: true }, { k: 'review', n: 'Надзор и преглед (кој што прегледува, кога)', t: 'area', req: true },
      { k: 'consult', n: 'Консултации и разлики во мислења', t: 'area', req: true },
      { k: 'archive', n: 'Комплетирање и чување на досието (рок, места, години на чување)', t: 'area', req: true, ph: 'досието се комплетира во 60 дена по поднесувањето; се чува најмалку 10 години' },
    ],
  },
  {
    k: 'res', n: 'Ресурси', clause: 'ISQM 1 §32', ic: '🧰', evidence: false,
    hint: 'Луѓе (вработување, компетентност по улога, обуки и CPD – во „Вработени“), технологија (WISE, резервни копии, пристап), интелектуални ресурси (шаблони, прописи), надворешни даватели.',
    fields: [
      { k: 'people', n: 'Човечки ресурси (вработување, распоредување, оценување)', t: 'area', req: true }, { k: 'tech', n: 'Технолошки ресурси (програма, резервни копии, безбедност)', t: 'area', req: true },
      { k: 'intel', n: 'Интелектуални ресурси (методологија, шаблони, прописи)', t: 'area', req: true }, { k: 'providers', n: 'Надворешни даватели на услуги и како се проверуваат', t: 'area' },
    ],
  },
  {
    k: 'info', n: 'Информации и комуникација', clause: 'ISQM 1 §33', ic: '📣', evidence: false,
    hint: 'Како информациите за квалитетот стигнуваат до вработените (состаноци, упатства), до клиентите (писмо за ангажман, поплаки) и до надворешни страни (ИСОС, УЈП).',
    fields: [{ k: 'internal', n: 'Внатрешна комуникација', t: 'area', req: true }, { k: 'external', n: 'Комуникација со клиенти и надворешни страни', t: 'area', req: true }],
  },
  {
    k: 'monitor', n: 'Процес на следење и отстранување', clause: 'ISQM 1 §35–47', ic: '🔍', evidence: true,
    hint: 'Годишно: проверка на завршени ангажмани (лице што не учествувало), наоди, анализа на коренската причина, мерки за отстранување и проверка дека мерките делуваат. Наодите се внесуваат и во ISO „Неусогласености“.',
    fields: [
      { k: 'inspected', n: 'Проверени завршени ангажмани (фирма, година, проверувач)', t: 'area', req: true }, { k: 'findings', n: 'Наоди и недостатоци', t: 'area', req: true },
      { k: 'rootCause', n: 'Коренска причина', t: 'area' }, { k: 'remediation', n: 'Мерки за отстранување, рок и одговорен', t: 'area' },
      { k: 'effective', n: 'Проверка на ефективноста на мерките', t: 'area' },
    ],
  },
  {
    k: 'eval', n: 'Годишна оценка на системот', clause: 'ISQM 1 §53–54', ic: '🏁', evidence: true,
    hint: 'Лицето со крајна одговорност најмалку еднаш годишно заклучува дали системот дава разумно уверување дека целите на квалитетот се постигнати.',
    fields: [
      { k: 'by', n: 'Оценил (лице со крајна одговорност)', req: true }, { k: 'date', n: 'Датум на оценката', t: 'date', req: true },
      { k: 'conclusion', n: 'Заклучок', t: 'sel', req: true, o: ['', 'системот дава разумно уверување', 'дава разумно уверување, освен за недостатоците наведени подолу', 'не дава разумно уверување'] },
      { k: 'basis', n: 'Основа за заклучокот и мерки', t: 'area', req: true },
    ],
  },
];
export const sqmComp = (k: string) => SQM_COMPONENTS.find((x) => x.k === k);
export const sqmKind = (k: string) => `sqm_${k}`;

/** Sign-off and evidence common to every component form. */
export interface SqmData extends FormMeta { [k: string]: unknown; owner?: string | null; signedBy?: string | null; signedOn?: string | null }

export function sqmNormalize(c: SqmComp, v: Record<string, unknown>): SqmData {
  const d: SqmData = {};
  for (const f of c.fields) {
    const x = v[f.k];
    if (f.t === 'date') { if (isDate(x)) d[f.k] = x; } else if (f.t === 'sel') { if (f.o?.includes(String(x)) && x) d[f.k] = String(x); } else if (str(x)) d[f.k] = str(x);
  }
  const uid = (x: unknown) => (typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x) ? x : null);
  d.owner = uid(v.owner); d.signedBy = uid(v.signedBy); d.signedOn = isDate(v.signedOn) ? v.signedOn : null;
  return d;
}

/** Component status: documented (required fields), signed off (who + when), evidence (when required). */
export function sqmStatus(c: SqmComp, d: SqmData | null, files: number) {
  const missing = c.fields.filter((f) => f.req && !d?.[f.k]).map((f) => f.n);
  const documented = !!d && missing.length === 0;
  const signed = !!d?.signedBy && !!d?.signedOn;
  const evidence = !c.evidence || files > 0;
  return { documented, signed, evidence, owner: !!d?.owner, missing, ok: documented && signed && evidence && !!d?.owner };
}

/** Starting text of the components with the office name (the office edits and signs it off). */
export function sqmStarter(office: string): Record<string, Record<string, string>> {
  const o = office || 'Канцеларијата';
  return {
    risk: {
      objectives: '1. Сите пријави и извештаи на клиентите се поднесуваат во законскиот рок.\n2. Секоја годишна сметка ја прегледува второ лице пред поднесување.\n3. Секој клиент има потпишан договор, писмо за ангажман и важечка УФР анализа.\n4. Вработените се компетентни за нивната улога и ги исполнуваат часовите за професионален развој.\n5. Податоците на клиентите се доверливи и заштитени.',
      risks: '1. Пропуштен рок поради отсуство на вработен или задоцнети документи од клиентот.\n2. Грешка во даночниот биланс или годишната сметка.\n3. Прифаќање клиент со висок ризик без анализа (ЗСППФТ).\n4. Судир на интереси или загрозена објективност.\n5. Губење или неовластен пристап до податоци.',
      responses: '1. Рокови во WISE со потсетници, замена при отсуство, месечен список на недостасни документи до клиентот.\n2. Контрола на завршната сметка во WISE и преглед од второ лице (ISQM 1 листа).\n3. Листа за прифаќање по фирма и година, УФР анализа пред почеток.\n4. Годишна изјава за етика и независност, проценка на компетентност по улога, евиденција на CPD.\n5. Лични корисници и улоги, дневник на промени, дневни резервни копии.',
    },
    gov: { culture: `Управителот на ${o} го поставува квалитетот како прв приоритет: одлуките за клиенти, рокови и ресурси се носат со оглед на квалитетот, вработените се оценуваат и по квалитетот на работата, а пропустите се третираат како прилика за подобрување, не за казнување.` },
    ethics: {
      policy: 'Секој вработен годишно потпишува изјава за етика, независност и доверливост (IESBA), со список на клиентите на кои работи. Вработен со финансиски интерес, семејна или деловна врска со клиент не работи на тој клиент. Секој судир на интереси се пријавува веднаш на одговорниот за етика, кој одлучува за мерки (друг вработен, прекин на ангажман).',
      gifts: 'Не се примаат подароци и гостопримство од клиенти освен со симболична вредност; секој подарок над симболична вредност се пријавува и се одбива.',
    },
    accept: {
      procedure: 'Пред почеток на работа со нов клиент и на почетокот на секоја година за постојните: листа ISQM 1 во WISE (интегритет, УФР анализа, ризик, компетентност и време, независност, договор, писмо за ангажман). Одлуката ја носи управителот и се запишува со датум.',
      declineRule: 'Се одбива или прекинува: кога клиентот не дава податоци за вистинскиот сопственик, при сомнеж за перење пари, при неможност за независност, кога клиентот бара невистинско прикажување или постојано не доставува документи.',
    },
    perf: {
      method: 'Сите книжења, пријави и годишни сметки се прават во WISE со вградените контроли (бруто биланс, логика на салда, ДДВ, плати), шаблоните на канцеларијата и законските рокови.',
      review: 'Секое месечно затворање го проверува одговорниот сметководител; годишната сметка и даночниот биланс ги прегледува второ лице пред поднесување, со запис кој и кога.',
      consult: 'Сложените прашања (даночни, сметководствени) се консултираат со управителот или надворешен советник; заклучокот се запишува во досието. Кај различни мислења одлучува управителот, а одлуката се образложува.',
      archive: 'Досието на ангажманот се комплетира најдоцна 60 дена по поднесувањето на годишната сметка и се чува најмалку 10 години (WISE со резервни копии).',
    },
    res: {
      people: 'Секоја улога има утврдени барања за компетентност; новите вработени работат под надзор; годишно се проценува компетентноста и се следат часовите за професионален развој.',
      tech: 'WISE со лични корисници и улоги, дневник на промени, дневни шифрирани резервни копии и проверка на враќањето двапати годишно.',
      intel: 'Шаблоните и политиките на канцеларијата, законите и стандардите во WISE (Закони), ажурирани при секоја законска измена.',
    },
    info: {
      internal: 'Месечен состанок за роковите и проблемите; законските измени и наодите од следењето се соопштуваат писмено на сите вработени.',
      external: 'Клиентите ги добиваат писмото за ангажман, известувања за рокови и список на недостасни документи; поплаките се примаат и решаваат по постапката (ISO 10002).',
    },
  };
}

/* ================= people – competence per role, CPD (ISQM 1 §32, IES 7) ================= */

/** Competence required per role. */
export const ROLE_COMPETENCE: Record<string, readonly string[]> = {
  admin: ['Овластен сметководител / член на ИСОС', 'Знаење на МСС / МСФИ и даночните закони', 'Преглед на годишни сметки и даночни биланси', 'Управување со квалитет (ISQM 1) и етика (IESBA)', 'ЗСППФТ – овластено лице'],
  senior: ['Овластен сметководител / член на ИСОС', 'Годишна сметка, даночен биланс, ДДВ', 'Преглед на работата на другите', 'ЗСППФТ – анализа на клиент'],
  acc: ['Книжење и главна книга', 'ДДВ пријави и книги', 'Пресметка на плати и МПИН', 'Работа во WISE'],
  oper: ['Внес на документи во WISE', 'Препознавање на видови документи', 'Доверливост на податоците'],
  teren: ['Прием и предавање на документи', 'Доверливост на податоците'],
  view: ['Доверливост на податоците'],
};
export const roleCompetence = (role: Role | string) => ROLE_COMPETENCE[role] ?? ROLE_COMPETENCE.view!;

/**
 * Status in the ИСОС registers and the continuing professional development it requires (Закон за вршење на
 * сметководствени работи, чл. 30): сметководител 90 h in 3 years, at least 24 h a year; овластен сметководител 120 h in
 * 3 years, at least 32 h a year.
 */
export type IsosStatus = '' | 'smet' | 'ovl';
export const ISOS_STATUS: Record<Exclude<IsosStatus, ''>, string> = { smet: 'Сметководител (регистар на ИСОС)', ovl: 'Овластен сметководител (регистар на ИСОС)' };
export const CPD_RULES: Record<Exclude<IsosStatus, ''>, { year: number; three: number }> = { smet: { year: 24, three: 90 }, ovl: { year: 32, three: 120 } };
/** The stricter rule (овластен) – kept for the texts that name one number. */
export const CPD_MIN_YEAR = CPD_RULES.ovl.year;
export const CPD_MIN_3Y = CPD_RULES.ovl.three;

export interface CpdEntry { date: string; topic: string; provider: string; hours: number; structured: boolean }
export interface StaffData extends FormMeta {
  /** Requirement index → met. */
  met: Record<string, boolean>;
  /** In an ИСОС register (true for сметководител and овластен); `isos` says which. */
  licensed: boolean; licence: string;
  isos: IsosStatus;
  cpd: CpdEntry[];
  assessedBy?: string | null; assessedOn?: string | null; note: string;
  /** An assessor outside the office (for the owner of a one-person office). */
  assessedExt: string;
}

export function staffNormalize(v: Record<string, unknown>): StaffData {
  const cpd = (Array.isArray(v.cpd) ? v.cpd : []).map((e: Record<string, unknown>) => ({
    date: isDate(e?.date) ? e.date : '', topic: str(e?.topic, 300), provider: str(e?.provider, 200),
    hours: Math.max(0, Math.round((Number(String(e?.hours ?? '').replace(',', '.')) || 0) * 10) / 10), structured: e?.structured !== false,
  })).filter((e) => e.topic && e.hours > 0 && e.date);
  const met = Object.fromEntries(Object.entries((v.met as Record<string, unknown>) ?? {}).filter(([k, x]) => /^\d+$/.test(k) && x === true).map(([k]) => [k, true]));
  const uid = (x: unknown) => (typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x) ? x : null);
  // older records knew only „овластен / член на ИСОС“ (licensed) – that is the овластен rule
  const isos: IsosStatus = v.isos === 'smet' || v.isos === 'ovl' ? v.isos : v.licensed === true ? 'ovl' : '';
  return { met, licensed: isos !== '', isos, licence: str(v.licence, 100), cpd, assessedBy: uid(v.assessedBy), assessedOn: isDate(v.assessedOn) ? v.assessedOn : null, note: str(v.note, 2000), assessedExt: str(v.assessedExt, 200) };
}

export const cpdHours = (L: readonly CpdEntry[] | undefined) => Math.round((L ?? []).reduce((s, e) => s + e.hours, 0) * 10) / 10;

/** Staff status: competence assessed by someone else, all requirements met, CPD hours (licensed only). */
export function staffStatus(role: string, d: StaffData | null, userId: string, prev: { y1: number; y2: number } = { y1: 0, y2: 0 }) {
  const req = roleCompetence(role);
  const met = req.filter((_, i) => d?.met[String(i)]).length;
  const assessed = !!d?.assessedOn && ((!!d.assessedBy && d.assessedBy !== userId) || !!d.assessedExt);
  const hours = cpdHours(d?.cpd), three = Math.round((hours + prev.y1 + prev.y2) * 10) / 10;
  const rule = d?.isos ? CPD_RULES[d.isos] : null;
  const cpdOk = !rule || hours >= rule.year;
  return { req, met, assessed, hours, three, rule, cpdOk, three3Ok: !rule || three >= rule.three, ok: !!d && assessed && met === req.length && cpdOk };
}

/* ================= ISRS 4410 – engagement file and the compiler's report ================= */

/** The compiler's report (ISRS 4410 (Revised) §40) for the year's financial statements. */
export function crHtml(firm: KdFirm, O: KdOffice, year: number, l: Pick<ElLetter, 'framework'> | null, f: ElFile, fw: string): string {
  const b = (v: unknown) => (v ? esc(v) : '____________________');
  const p = (t: string) => `<p style="margin:0 0 8px;text-align:justify">${t}</p>`;
  const end = `31.12.${year}`;
  return `<div style="font-family:'Times New Roman',Georgia,serif;font-size:12.5px;line-height:1.55;color:#111">
  <h1 style="text-align:center;font-size:16px;margin:0 0 4px">ИЗВЕШТАЈ НА СМЕТКОВОДИТЕЛОТ ЗА СОСТАВУВАЊЕ</h1>
  <p style="text-align:center;margin:0 0 12px">согласно ISRS 4410 (ревидиран)</p>
  <p style="margin:0 0 10px">До раководството на <b>${b(firm.name)}</b>, ${b([firm.address, firm.city].filter(Boolean).join(', '))}</p>
  ${p(`Врз основа на информациите што ни ги дадовте, ги составивме приложените финансиски извештаи на ${b(firm.name)}, кои се состојат од билансот на состојба на ден ${end} година, билансот на успех за годината што завршува на тој датум и објаснувачките белешки, вклучувајќи го прегледот на значајните сметководствени политики${f.fsDate ? `, одобрени од раководството на ${esc(dmy(f.fsDate))}` : ''}.`)}
  ${p(`Финансиските извештаи се составени според ${esc(fw)}${l ? '' : ''}.`)}
  ${p('<b>Одговорност на раководството.</b> Раководството е одговорно за финансиските извештаи, за точноста и целосноста на информациите што се користени за нивното составување и за изборот на применливата рамка.')}
  ${p('<b>Наша одговорност.</b> Ангажманот го изведовме согласно Меѓународниот стандард за сродни услуги ISRS 4410 (ревидиран) „Ангажмани за составување“. Ги применивме нашите стручни знаења од областа на сметководството и финансиското известување за да Ви помогнеме во изготвувањето и презентирањето на овие финансиски извештаи во согласност со применливата рамка. Ги почитувавме релевантните етички барања, вклучувајќи ги начелата на интегритет, објективност, професионална компетентност и должно внимание од Кодексот на етика на IESBA.')}
  ${p('<b>Ова не е ревизија ниту преглед.</b> Финансиските извештаи и точноста и целосноста на информациите користени за нивното составување се одговорност на раководството. Бидејќи ангажманот за составување не е ангажман за уверување, од нас не се бара да ја проверуваме точноста или целосноста на информациите што ни ги дадовте за составувањето. Според тоа, не изразуваме ревизорско мислење ниту заклучок за преглед за тоа дали овие финансиски извештаи се подготвени во согласност со применливата рамка.')}
  <div style="display:flex;justify-content:space-between;margin-top:28px;gap:30px;page-break-inside:avoid">
    <div>${b(O.city)}, ${f.reportOn ? esc(dmy(f.reportOn)) : '__________'} година<br>${b([O.address, O.city].filter(Boolean).join(', '))}</div>
    <div style="text-align:center;min-width:70mm"><b>${b(O.name)}</b><div style="margin-top:30px;border-top:1px solid #111;padding-top:3px">${esc(O.rep || '')}${O.repRole ? ', ' + esc(O.repRole) : ''}<br><small>(потпис и печат)</small></div></div>
  </div></div>`;
}

/* ================= readiness for the ИСОС quality-control review ================= */

export interface ReadyItem { n: string; ok: boolean; info?: string; href?: string }
export interface ReadySection { k: string; n: string; clause: string; items: ReadyItem[] }

export interface ReadyInput {
  year: number; today: string;
  /** ISQM 1 component → stored data and the number of evidence files. */
  sqm: Record<string, { d: SqmData | null; files: number }>;
  staff: { id: string; name: string; role: string; d: StaffData | null; prev: { y1: number; y2: number }; ethicsAt: string | null; files: number }[];
  firms: { id: string; name: string; letter: 'signed' | 'draft' | null; qc: QcData | null; qcPrev: QcData | null; docFiles: number }[];
}

/** The readiness checklist: what an ИСОС reviewer asks for, each item with ok and where to fix it. */
export function ifacReadiness(x: ReadyInput) {
  const S: ReadySection[] = [];
  S.push({
    k: 'sqm', n: 'Систем за управување со квалитет (ISQM 1)', clause: 'ISQM 1 §16–54',
    items: SQM_COMPONENTS.flatMap((c) => {
      const s = sqmStatus(c, x.sqm[c.k]?.d ?? null, x.sqm[c.k]?.files ?? 0);
      const href = `/ifac?t=sqm&c=${c.k}`;
      const it: ReadyItem[] = [{ n: `${c.ic} ${c.n} – документирано`, ok: s.documented, info: s.missing.length ? `недостасува: ${s.missing.join(', ')}` : undefined, href }];
      it.push({ n: `${c.ic} ${c.n} – одговорно лице и потпис (кој / кога)`, ok: s.owner && s.signed, href });
      if (c.evidence) it.push({ n: `${c.ic} ${c.n} – доказ во прилог`, ok: s.evidence, href });
      return it;
    }),
  });
  const ev = x.sqm.eval?.d;
  if (ev?.date && String(ev.date).slice(0, 4) !== String(x.year) && x.today.slice(0, 4) === String(x.year)) S[0]!.items.push({ n: `🏁 Годишната оценка е за ${x.year}`, ok: false, info: `последна ${dmy(String(ev.date))}`, href: '/ifac?t=sqm&c=eval' });

  const St = x.staff.map((s) => ({ s, st: staffStatus(s.role, s.d, s.id, s.prev) }));
  const lic = St.filter((q) => q.s.d?.licensed);
  S.push({
    k: 'people', n: 'Вработени – етика, компетентност, професионален развој', clause: 'ISQM 1 §29, §32 · IESBA · IES 7',
    items: [
      { n: 'Годишна изјава за етика, независност и доверливост – сите вработени', ok: x.staff.length > 0 && x.staff.every((s) => s.ethicsAt), info: `${x.staff.filter((s) => s.ethicsAt).length} / ${x.staff.length}`, href: '/ifac?t=et' },
      { n: 'Компетентност по улога проценета од друго лице – сите вработени', ok: St.length > 0 && St.every((q) => q.st.assessed), info: `${St.filter((q) => q.st.assessed).length} / ${St.length}`, href: '/ifac?t=staff' },
      { n: 'Барањата за компетентност на улогата исполнети', ok: St.length > 0 && St.every((q) => q.st.met === q.st.req.length), info: St.filter((q) => q.st.met < q.st.req.length).map((q) => q.s.name).join(', ') || undefined, href: '/ifac?t=staff' },
      { n: 'КПУ во годината (ЗВСР чл. 30): сметководител најмалку 24 ч., овластен сметководител најмалку 32 ч.', ok: lic.every((q) => q.st.cpdOk), info: lic.length ? lic.map((q) => `${q.s.name} ${q.st.hours} / ${q.st.rule?.year} ч.`).join(', ') : 'нема означени сметководители во регистарот на ИСОС', href: '/ifac?t=staff' },
      { n: 'КПУ во 3 години: сметководител 90 ч., овластен сметководител 120 ч.', ok: lic.every((q) => q.st.three3Ok), info: lic.length ? lic.map((q) => `${q.s.name} ${q.st.three} / ${q.st.rule?.three} ч.`).join(', ') : undefined, href: '/ifac?t=staff' },
      { n: 'Доказ за обуките (сертификати) во прилог', ok: lic.every((q) => q.s.files > 0 || !q.s.d?.cpd.length), href: '/ifac?t=staff' },
    ],
  });

  const F = x.firms;
  const decided = (q: QcData | null) => !!q && (q.decision === 'accept' || q.decision === 'continue') && !!q.decidedOn;
  const reviewed = (q: QcData | null) => qcReviewed(q);
  const docOk = (f: ReadyInput['firms'][number]) => !!f.qcPrev && elFileStatus(f.qcPrev.doc ?? elFileNormalize(null), f.docFiles).ok;
  const miss = (L: typeof F) => (L.length ? L.slice(0, 8).map((f) => f.name).join(', ') + (L.length > 8 ? ' …' : '') : undefined);
  S.push({
    k: 'eng', n: 'Ангажмани со клиентите', clause: 'ISQM 1 §30–31 · ISRS 4410',
    items: [
      { n: `Писмо за ангажман за ${x.year} потпишано – сите клиенти`, ok: F.length > 0 && F.every((f) => f.letter === 'signed'), info: miss(F.filter((f) => f.letter !== 'signed')), href: '/ifac?t=all' },
      { n: `Одлука за прифаќање / продолжување за ${x.year} – сите клиенти`, ok: F.length > 0 && F.every((f) => decided(f.qc)), info: miss(F.filter((f) => !decided(f.qc))), href: '/ifac?t=all' },
      { n: `Годишна сметка ${x.year - 1} прегледана од второ лице`, ok: F.length > 0 && F.every((f) => reviewed(f.qcPrev)), info: miss(F.filter((f) => !reviewed(f.qcPrev))), href: '/ifac?t=all' },
      { n: `Досие на ангажманот ${x.year - 1} (прашања, проценки, комуникација, потврда на раководството, извештај)`, ok: F.length > 0 && F.every(docOk), info: miss(F.filter((f) => !docOk(f))), href: '/ifac?t=all' },
    ],
  });
  const all = S.flatMap((s) => s.items);
  return { sections: S, done: all.filter((i) => i.ok).length, total: all.length, pct: all.length ? Math.round((all.filter((i) => i.ok).length / all.length) * 100) : 0 };
}

