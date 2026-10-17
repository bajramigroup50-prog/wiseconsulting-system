/**
 * UX Phase 3 (docs/ux-rindertim.md P35–P38, P43): the scheduled automations of the office. The program PREPARES
 * (drafts + a „Преглед“ list), a person CONFIRMS: nothing is posted, filed, sent to a client or to УЈП without a click,
 * nothing is done in a locked period, demo firms are never touched, every mass action is audited.
 *
 * Pure: the list of automations (schedule, default, review screen), the office switches stored in
 * `app_settings[AUTO_SETTINGS_KEY]` and their cleaning. The worker jobs and the services live in `@wise/db`
 * (`automation/*`) and `apps/worker/src/jobs/automations2.ts`.
 */

export const AUTO_KINDS = ['close', 'payroll', 'vat', 'reports', 'lawrep', 'dunning', 'aml', 'lawTexts', 'service'] as const;
export type AutoKind = (typeof AUTO_KINDS)[number];
export const isAutoKind = (k: unknown): k is AutoKind => typeof k === 'string' && (AUTO_KINDS as readonly string[]).includes(k);

export interface AutoMeta {
  /** Proposal number in docs/ux-rindertim.md. */
  p: string;
  name: string;
  /** What is prepared (one line for the owner's panel). */
  what: string;
  /** Schedule in words (Europe/Skopje). */
  when: string;
  /** pg-boss job name. */
  job: string;
  /** Default of the „автоматски“ switch. */
  dflt: boolean;
  /** Where the prepared work is reviewed. */
  screen: string;
}

/** Job names (pg-boss). */
export const AUTO_JOB = {
  close: 'auto.close', payroll: 'auto.payroll', vat: 'auto.vat', reports: 'auto.reports', lawrep: 'auto.lawrep',
  dunning: 'auto.dunning', aml: 'auto.aml', lawTexts: 'law.texts', service: 'reminders',
} as const satisfies Record<AutoKind, string>;

export const AUTO_META: Readonly<Record<AutoKind, AutoMeta>> = {
  close: {
    p: 'P35', name: 'Месечно затворање – подготвено за заклучување', job: AUTO_JOB.close, dflt: false, screen: '/zatvoranje',
    what: 'ги проверува задачите за затворање на минатиот месец кај секоја фирма и ги означува „подготвено за заклучување“ (никогаш не заклучува)',
    when: 'секоја ноќ во 02:10',
  },
  payroll: {
    p: 'P36', name: 'Плати – нацрти за сите фирми', job: AUTO_JOB.payroll, dflt: false, screen: '/plati/nacrti',
    what: 'пресметка на платата како НАЦРТ, копија од претходниот месец (вработени, часови по календар, параметри) – не се книжи',
    when: 'на избраниот ден во месецот во 05:20',
  },
  vat: {
    p: 'P37', name: 'ДДВ-04 – нацрт по период', job: AUTO_JOB.vat, dflt: false, screen: '/ddv/nacrti',
    what: 'по истекот на ДДВ периодот: пресметка на ДДВ-04 од книгите, за плаќање / поврат и проблемите (книги ≠ налози, фактури што недостасуваат)',
    when: 'секој ден во 05:40 (по истекот на периодот, додека не се затвори)',
  },
  reports: {
    p: 'P38', name: 'Месечен извештај за клиентите', job: AUTO_JOB.reports, dflt: false, screen: '/mesIzv',
    what: 'месечните извештаи за сите клиенти (бројки од книгите) како нацрт; објавување со „Објави ги сите подготвени“',
    when: 'на избраниот ден во месецот во 06:20',
  },
  lawrep: {
    p: 'P43', name: 'Даночен преглед на сите фирми', job: AUTO_JOB.lawrep, dflt: false, screen: '/autop',
    what: 'прелиминарниот даночен преглед (⚖️) за сите фирми – наодите во Автопилот',
    when: 'секоја ноќ во 03:10',
  },
  dunning: {
    p: 'P43', name: 'Опомени – предлози по ниво', job: AUTO_JOB.dunning, dflt: false, screen: '/opomeni',
    what: 'купувачите со достасани неплатени фактури и предложеното ниво на опомена; праќањето е рачно',
    when: 'секој понеделник во 06:30',
  },
  aml: {
    p: 'P43', name: 'УФР – мониторинг и рок за чување', job: AUTO_JOB.aml, dflt: false, screen: '/aml',
    what: 'мониторинг на книжењата (сигнали за преглед) и листа на записи со истечен рок за чување – никогаш не се бришат сами',
    when: 'секоја недела во 04:00',
  },
  lawTexts: {
    p: 'P43', name: 'Текстови на законите', job: AUTO_JOB.lawTexts, dflt: true, screen: '/zakoni',
    what: 'синхронизација на пречистените текстови од службените извори (како досега, од законскиот робот)',
    when: 'еднаш неделно, со дневниот законски робот',
  },
  service: {
    p: 'P43', name: 'Потсетници за сервис', job: AUTO_JOB.service, dflt: false, screen: '/potsetnici',
    what: 'подготвени пораки за возилата што доаѓаат на сервис (во канцеларијата); праќањето е рачно',
    when: 'со часовните потсетници, еднаш дневно',
  },
};

/** `app_settings` key of the switches and options. */
export const AUTO_SETTINGS_KEY = 'automations';
/** `app_settings` key of a job's last run (`{ at, summary }`, P42 status line). */
export const autoRunKey = (k: AutoKind) => `autoRun:${k}`;

export interface AutoSettings {
  on: Record<AutoKind, boolean>;
  /** P36: day of the month the payroll drafts are made (1–28). */
  payDay: number;
  /** P36: the month prepared — `prev` = the month that just ended (default), `cur` = the current month. */
  payMonth: 'prev' | 'cur';
  /** P38: day of the month the client reports are prepared (1–28). */
  reportDay: number;
  /** P38: also queue the 💲 AI summary (off by default; the monthly AI limit still applies). */
  reportAi: boolean;
  /** P38: publish to the client portal without the owner's click (off by default). */
  reportPublish: boolean;
}

const day = (v: unknown, d: number) => { const n = Math.trunc(Number(v)); return n >= 1 && n <= 28 ? n : d; };

export function autoSettingsClean(v: unknown): AutoSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const on0 = (o.on && typeof o.on === 'object' ? o.on : {}) as Record<string, unknown>;
  const on = Object.fromEntries(AUTO_KINDS.map((k) => [k, typeof on0[k] === 'boolean' ? on0[k] as boolean : AUTO_META[k].dflt])) as Record<AutoKind, boolean>;
  return {
    on, payDay: day(o.payDay, 1), payMonth: o.payMonth === 'cur' ? 'cur' : 'prev', reportDay: day(o.reportDay, 5),
    reportAi: o.reportAi === true, reportPublish: o.reportPublish === true,
  };
}

/** Status of a draft: waiting for a person, confirmed (posted / locked / closed / published), dismissed. */
export type AutoDraftStatus = 'draft' | 'confirmed' | 'dismissed';

/** Previous month `YYYY-MM` of `YYYY-MM`. */
export const ymPrev = (ym: string): string => {
  let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
  if (!m) { m = 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
};

/** Monthly / day-of-month jobs: is `today` (YYYY-MM-DD) the configured day? */
export const isAutoDay = (today: string, d: number) => +today.slice(8, 10) === d;

/** A difference worth a look in the payroll review (more than 1 denar or 0,5 %). */
export function payDiffFlag(cur: number, prev: number | null | undefined): boolean {
  if (prev == null) return true;
  const d = Math.abs(cur - prev);
  return d > 1 && d > Math.abs(prev) * 0.005;
}
