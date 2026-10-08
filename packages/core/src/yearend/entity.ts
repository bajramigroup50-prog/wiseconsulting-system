/**
 * Entity type of a firm for the year-end (legacy `LF_OPTS`/`LF_ENT`/`lfGuess` 10401–10403, `ENT`/`entGuess`/`entOf`
 * 10405–10408, `ENT_V` 10409).
 *
 * FIX(P8 #12): legacy had two discriminators — `npoMode` ("the chart contains 730") and `entOf` (legal form / name
 * guess) — and `mbyllja`/`closeYear` were not gated by either. The rebuild decides WHAT the firm is only with
 * {@link yeEntityOf}; `npoChart` (yearend/npo.ts) only decides which chart an NPO books on. Close, statements and
 * tax returns all branch on the entity.
 */
import type { YeEntity } from '../yearend';

/** Legal forms grouped as in the legacy firm editor `[group, [[code, label]]]`. */
export const YE_LEGAL_FORMS: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
  ['Трговско друштво', [
    ['dooel', 'ДООЕЛ – друштво со ограничена одговорност од едно лице'],
    ['doo', 'ДОО – друштво со ограничена одговорност (повеќе содружници)'],
    ['ad', 'АД – акционерско друштво'],
    ['jtd', 'ЈТД / КД – јавно трговско / командитно друштво'],
  ]],
  ['Трговец поединец', [['tp', 'ТП – трговец поединец']]],
  ['Самостојна дејност', [
    ['adv', 'Адвокат'], ['not', 'Нотар'], ['izv', 'Извршител'], ['zan', 'Занаетчија'],
    ['lek', 'Лекар / стоматолог (приватна пракса)'], ['arh', 'Архитект / инженер / проценувач'], ['sd', 'Друга самостојна дејност'],
  ]],
  ['Непрофитна организација', [['zdr', 'Здружение на граѓани'], ['fon', 'Фондација'], ['soj', 'Сојуз / асоцијација']]],
];

/** Legal form → entity (legacy `LF_ENT`). */
export const YE_LF_ENT: Readonly<Record<string, YeEntity>> = {
  dooel: 'co', doo: 'co', ad: 'co', jtd: 'co', tp: 'tp',
  adv: 'sd', not: 'sd', izv: 'sd', zan: 'sd', lek: 'sd', arh: 'sd', sd: 'sd',
  zdr: 'npo', fon: 'npo', soj: 'npo',
};

export const YE_ENTITY_NAMES: Readonly<Record<YeEntity, string>> = {
  co: 'Трговско друштво (ДОО, ДООЕЛ, АД, ЈТД…)',
  tp: 'Трговец поединец (ТП)',
  sd: 'Самостојна дејност (адвокат, нотар, извршител, занаетчија, лекар, архитект…)',
  npo: 'Непрофитна организација (здружение, фондација, сојуз)',
};

/** Label of a legal-form code (legacy lookup inside `belAuto`). */
export function yeLegalFormName(code: string | null | undefined): string {
  for (const [, L] of YE_LEGAL_FORMS) for (const [k, n] of L) if (k === code) return n;
  return '';
}

/** Legacy `entGuess`: entity from the firm name. */
export function yeEntityGuess(name: string | null | undefined): YeEntity {
  const n = String(name || '').toUpperCase();
  if (/ЗДРУЖЕНИЕ|ФОНДАЦИЈА|СОЈУЗ НА|SHOQATA|FONDACION|АСОЦИЈАЦИЈА|КЛУБ|ДРУШТВО НА ПРИЈАТЕЛИ/.test(n)) return 'npo';
  if (/(^|\s)(ТП|T\.P\.|ТП\.)(\s|$)|ТРГОВЕЦ ПОЕДИНЕЦ/.test(n)) return 'tp';
  if (/АДВОКАТ|НОТАР|ИЗВРШИТЕЛ|AVOKAT|NOTER|ПРОЦЕНУВАЧ|СТЕЧАЕН УПРАВНИК|ЗАНАЕТЧИЈА|ЗАНАЕТЧИСКА|ЗАНАЕТЧИ/.test(n) && !/ДООЕЛ|ДОО|АД$/.test(n)) return 'sd';
  return 'co';
}

const ENTS: readonly YeEntity[] = ['co', 'tp', 'sd', 'npo'];

/** Legacy `entOf`: explicit entity (`settings.ent`) → legal form → name guess. */
export function yeEntityOf(f: { ent?: unknown; legalForm?: string | null; name?: string | null }): YeEntity {
  if (typeof f.ent === 'string' && (ENTS as readonly string[]).includes(f.ent)) return f.ent as YeEntity;
  const lf = String(f.legalForm || '').toLowerCase();
  if (YE_LF_ENT[lf]) return YE_LF_ENT[lf]!;
  return yeEntityGuess(f.name);
}

/** Year-end views restricted to some entity types (legacy `ENT_V`); views not listed are open to every entity. */
export const YE_ENTITY_VIEWS: Readonly<Record<string, readonly YeEntity[]>> = {
  zsNPO: ['npo'], zsTP: ['tp', 'sd'], zs_bu: ['co', 'tp'], zs_bs: ['co', 'tp'], zs_db: ['co'], zs_vp: ['co'],
  zs_de: ['co', 'tp'], zs_sp: ['co', 'tp'], zs_skr: ['co'], zs_aop: ['co', 'tp'],
};
export const yeViewFor = (view: string, ent: YeEntity): boolean => !YE_ENTITY_VIEWS[view] || YE_ENTITY_VIEWS[view]!.includes(ent);
