/**
 * HR documents as HTML (legacy `contractHTML` 6066 + memo/control-code wrapper 15605, `extHTML` 6086,
 * `diDoc`/`diHTML` 15623–15654, `docHead` 15587, `docFoot` 15602). Pure; used by the registry print route.
 *
 * FIX (#15): legacy `hrPdf` called `extHTML(e, d.snap.c, …)` for every non-contract registry entry, which threw
 * for disciplinary documents (their `snap` has no `.c`). `hrDocHtml` dispatches on the document kind.
 * Annual-leave decisions and sick-leave records are new registry kinds (not in legacy).
 */
import { HR_DI_GR, hrCtTypeName, hrFixedTerm, type HrContract, type HrDiDoc, type HrExtension } from '@wise/core/payroll';
import { dmy, fmt, h } from './html';

export interface DocFirm {
  name: string;
  address: string;
  city: string;
  edb: string;
  embs: string;
  email?: string;
  bankAccount?: string;
  signer: string;
  signerRole: string;
}
export interface DocEmployee {
  name: string;
  embg?: string | null;
  address?: string | null;
  position?: string | null;
  end?: string | null;
}

const serif = `font-family:'Times New Roman',Georgia,serif;font-size:12px;line-height:1.5;color:#111`;
const D = (x?: string | null) => (x ? dmy(x) : '__________');
const B = (x?: unknown) => (x ? h(x) : '____________________');
const N = (x?: number | string | null) => (x ? fmt(x) : '__________');
const months = (n: number | string) => (+n === 1 ? 'месец' : 'месеци');

/** Memo header with the firm and the control code (legacy `docHead`). */
export function docHead(F: DocFirm, code?: string, conf = true): string {
  const ln = [[F.address, F.city].filter(Boolean).join(', '), F.edb ? 'ЕДБ ' + F.edb : '', F.embs ? 'ЕМБС ' + F.embs : ''].filter(Boolean).join(' · ');
  const ln2 = [F.email || '', F.bankAccount ? 'Ж-сметка ' + F.bankAccount : ''].filter(Boolean).join(' · ');
  const ini = String(F.name || '?').replace(/^(ДРУШТВО|ДООЕЛ|ДОО|АД)\s+/i, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `<div class="dochead" style="display:flex;align-items:center;gap:12px;border-bottom:2px solid #0d5b4b;padding:0 0 6px;margin:0 0 10px;font-family:Arial,Helvetica,sans-serif">`
    + `<div style="width:13mm;height:13mm;border-radius:3mm;background:#0d5b4b;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px">${h(ini)}</div>`
    + `<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:12.5px;color:#0d5b4b;text-transform:uppercase">${h(F.name)}</div><div style="font-size:9px;color:#444">${h(ln)}</div>${ln2 ? `<div style="font-size:9px;color:#444">${h(ln2)}</div>` : ''}</div>`
    + `<div style="text-align:right;font-size:8.5px;color:#444;line-height:1.35">${conf ? '<div style="display:inline-block;border:1px solid #b42318;color:#b42318;font-weight:700;padding:1px 6px;border-radius:3px;letter-spacing:.5px;margin-bottom:2px">ДОВЕРЛИВО</div><br>' : ''}${code ? `Контролен код<br><b style="font-family:monospace;font-size:10px;color:#111">${h(code)}</b>` : ''}</div></div>`;
}

/** Footer with the control code (legacy `docFoot`). */
export const docFoot = (code: string, txt: string) =>
  `<p class="docfoot" style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:8.5px;color:#555;border-top:1px solid #ccc;padding-top:4px">${txt ? h(txt) + ' ' : ''}Контролен код: <b style="font-family:monospace">${h(code)}</b> – кодот се пресметува од содржината; ако некој податок во документот е изменет, кодот повеќе не се совпаѓа со оригиналот зачуван во програмата.</p>`;

const DRAFT = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0"><div style="transform:rotate(-30deg);font-size:90px;font-weight:800;color:rgba(180,35,24,.10);letter-spacing:10px;font-family:Arial">НАЦРТ</div></div>';
const wrap = (H: string, draft: boolean) => (draft ? `<div style="position:relative">${DRAFT}<div style="position:relative">${H}</div></div>` : `<div>${H}</div>`);

const sigRow = (left: [string, string], right: [string, string]) =>
  `<div class="sigrow" style="page-break-inside:avoid;break-inside:avoid;display:flex;justify-content:space-between;margin-top:46px;gap:30px">${[left, right].map(([t, n]) => `<div style="text-align:center;min-width:60mm"><b>${t}</b><div style="border-top:1px solid #111;margin-top:40px;padding-top:3px">${n}</div></div>`).join('')}</div>`;

/** Employment contract (legacy `contractHTML`). `draft` adds the НАЦРТ watermark (unsaved changes). */
export function contractHtml(f: DocFirm, e: DocEmployee, c: Partial<HrContract>, opts: { code?: string; draft?: boolean } = {}): string {
  const T = hrCtTypeName(c.type);
  let i = 0;
  const art = (t: string) => `<p style="text-align:center;margin:10px 0 4px"><b>Член ${++i}</b></p><p style="text-align:justify;margin:0">${t}</p>`;
  const fixed = hrFixedTerm(c.type);
  const H = `<div style="${serif}">`
    + `<p>Врз основа на Законот за работните односи, на ден ${D(c.signDate)} година во ${B(c.place)}, се склучи:</p>`
    + `<h1 style="text-align:center;font-family:'Times New Roman',Georgia,serif;font-size:17px;margin:14px 0 2px">ДОГОВОР ЗА ВРАБОТУВАЊЕ</h1>`
    + `<p style="text-align:center;margin:0 0 12px"><b>${h(T.toUpperCase())}</b>${c.no ? `<br>бр. ${h(c.no)}` : ''}</p><p style="margin:0">помеѓу:</p>`
    + `<p style="margin:4px 0 4px 18px">1. <b>${B(f.name)}</b>, со седиште на ${B([f.address, f.city].filter(Boolean).join(', '))}, ЕДБ ${B(f.edb)}, ЕМБС ${B(f.embs)}, застапувано од ${B(c.rep)} – ${B(c.repRole)} (во понатамошниот текст: <b>работодавач</b>), и</p>`
    + `<p style="margin:0 0 8px 18px">2. <b>${B(e.name)}</b>, ЕМБГ ${B(e.embg)}, со живеалиште на ${B(e.address)} (во понатамошниот текст: <b>работник</b>).</p>`
    + art(`Со овој договор се заснова работен однос ${h(T)}, при што работникот ќе ги извршува работите и работните задачи на работното место <b>${B(c.position)}</b>${c.duties ? `, кои опфаќаат: ${h(c.duties)}` : ''}, во согласност со актот за систематизација на работните места кај работодавачот.`)
    + art(`Работникот започнува со работа на ден <b>${D(c.start)}</b> година.${fixed ? ` Договорот се склучува на определено време до <b>${D(c.end)}</b> година${c.reason ? `, поради: ${h(c.reason)}` : ''}, по кој рок работниот однос престанува без отказ, освен ако не се продолжи или трансформира во согласност со закон.` : ' Договорот се склучува на неопределено време.'}${+(c.probation || 0) ? ` Се договара пробна работа во траење од ${h(c.probation)} ${months(c.probation!)}.` : ''}`)
    + art(`Работникот работата ќе ја извршува во ${B(c.workPlace)}${c.type === 'dom' ? ', односно од дома / на далечина, во согласност со закон' : ''}.`)
    + art(`Работникот засновува работен однос со ${+(c.hours ?? 40) >= 40 ? 'полно работно време од 40 часа неделно' : `скратено работно време од ${h(c.hours)} часа неделно`}. Распоредот на работното време го утврдува работодавачот.`)
    + art(`За извршената работа работникот има право на основна плата во бруто износ од <b>${N(c.gross)}</b> денари месечно${c.net ? ` (нето ${N(c.net)} денари)` : ''}, која не може да биде пониска од минималната плата утврдена со закон. Платата се исплатува најмалку еднаш месечно, најдоцна до 15-ти во тековниот месец за претходниот месец, на трансакциската сметка на работникот. Работникот има право и на додатоци на плата (минат труд, прекувремена работа, ноќна работа и др.) и надоместоци согласно закон и колективен договор.`)
    + art(`Работникот има право на годишен одмор од најмалку <b>${h(c.leave)}</b> работни дена во календарската година, дневен и неделен одмор, отсуство и други права согласно Законот за работните односи и колективниот договор.`)
    + art('Работникот е должен работата да ја извршува совесно и стручно, да ги почитува мерките за безбедност и здравје при работа и да ги чува деловните тајни на работодавачот. Работодавачот е должен да му обезбеди на работникот работа, плата и безбедни услови за работа и да го пријави во задолжително социјално осигурување.')
    + art(`Договорот може да престане на начините утврдени со закон. Отказниот рок изнесува ${h(c.notice)} ${months(c.notice ?? 1)}, освен ако со закон или колективен договор не е поинаку утврдено.`)
    + art('За сè што не е уредено со овој договор се применуваат одредбите на Законот за работните односи, колективниот договор и општите акти на работодавачот. Евентуалните спорови страните ќе ги решаваат спогодбено, а доколку тоа не е можно, надлежен е стварно и месно надлежниот суд.')
    + art('Договорот е составен во 3 (три) еднакви примероци, од кои по 1 (еден) за секоја страна и 1 (еден) за Агенцијата за вработување.')
    + sigRow(['РАБОТНИК', h(e.name)], ['РАБОТОДАВАЧ', `${h(c.rep || '')}, ${h(c.repRole || '')}<br>М.П.`]) + '</div>';
  const code = opts.code ?? '';
  return wrap(docHead(f, code) + H + (code ? docFoot(code, 'Договор за вработување – ' + e.name + '.') : ''), !!opts.draft);
}

/** Annex or decision extending / transforming a fixed-term contract (legacy `extHTML`). */
export function extHtml(f: DocFirm, e: DocEmployee, c: Partial<HrContract>, x: HrExtension, code?: string): string {
  const isOdl = x.doc === 'odluka', isTr = x.kind === 'transform';
  const who = `<b>${B(e.name)}</b>, ЕМБГ ${B(e.embg)}`;
  const orig = `Договорот за вработување${c.no ? ' бр. ' + h(c.no) : ''} од ${D(c.signDate)} година`;
  const body = isTr
    ? `Работниот однос на работникот ${who}, засновен со ${orig} на определено време, <b>се трансформира во работен однос на неопределено време</b>, почнувајќи од ${D(x.date)} година. Сите други одредби од договорот остануваат непроменети.`
    : `Се <b>продолжува</b> работниот однос на определено време на работникот ${who}, засновен со ${orig}, на работното место ${B(c.position)}, <b>до ${D(x.end)}</b> година${x.reason ? ', поради: ' + h(x.reason) : ''}. Сите други одредби од договорот остануваат непроменети.`;
  const h1 = `font-family:'Times New Roman',Georgia,serif;font-size:17px;margin:16px 0;text-align:center`;
  let H: string;
  if (isOdl) {
    H = `<div style="${serif}"><p><b>${B(f.name)}</b>, ${B([f.address, f.city].filter(Boolean).join(', '))}<br>Бр. ${h(x.no || '______')}<br>${h(c.place || f.city || '')}, ${D(x.date)} година</p>`
      + `<p>Врз основа на Законот за работните односи и ${orig}, ${B(c.rep)} – ${B(c.repRole)} на ${B(f.name)} донесе:</p>`
      + `<h1 style="${h1}">О Д Л У К А<br><span style="font-size:13px">${isTr ? 'за трансформација на работен однос од определено во неопределено време' : 'за продолжување на договор за вработување на определено време'}</span></h1>`
      + `<p style="text-align:center"><b>I</b></p><p style="text-align:justify">${body}</p><p style="text-align:center"><b>II</b></p><p style="text-align:justify">Одлуката влегува во сила со денот на донесувањето. Врз основа на одлуката ќе се изврши промена во задолжителното социјално осигурување (Агенција за вработување).</p>`
      + `<p style="text-align:center"><b>Образложение</b></p><p style="text-align:justify">${isTr ? 'Работникот ги исполнува условите за вработување на неопределено време и потребата од работното место е трајна.' : 'Потребата од извршување на работите на работното место продолжува' + (x.reason ? ' (' + h(x.reason) + ')' : '') + ', поради што се донесе одлука како во диспозитивот.'}</p>`
      + `<div style="margin-top:40px;text-align:right"><b>${B(c.repRole)}</b><div style="border-top:1px solid #111;margin:40px 0 0 auto;width:60mm;padding-top:3px;text-align:center">${B(c.rep)}<br>М.П.</div></div><p style="margin-top:20px">Доставено до: работникот, архива, досие.</p></div>`;
  } else {
    H = `<div style="${serif}"><p>Врз основа на Законот за работните односи, на ден ${D(x.date)} година во ${B(c.place || f.city)}, помеѓу <b>${B(f.name)}</b>, ЕДБ ${B(f.edb)}, застапувано од ${B(c.rep)} – ${B(c.repRole)} (работодавач), и ${who}, со живеалиште на ${B(e.address)} (работник), се склучи:</p>`
      + `<h1 style="${h1}">АНЕКС ${x.no ? 'бр. ' + h(x.no) : ''}<br><span style="font-size:13px">кон ${orig}</span></h1>`
      + `<p style="text-align:center"><b>Член 1</b></p><p style="text-align:justify">${body}</p><p style="text-align:center"><b>Член 2</b></p><p style="text-align:justify">Анексот е составен во 3 (три) еднакви примероци и стапува на сила со денот на потпишувањето.</p>`
      + sigRow(['РАБОТНИК', h(e.name)], ['РАБОТОДАВАЧ', `${h(c.rep || '')}, ${h(c.repRole || '')}<br>М.П.`]) + '</div>';
  }
  return docHead(f, code, false) + H + (code ? docFoot(code, (isOdl ? 'Одлука' : 'Анекс') + ' – ' + e.name + '.') : '');
}

/* ---------- block renderer for disciplinary documents (legacy `zzHTML` blocks) ---------- */
type Block = { h: string } | { sub: string } | { p: string } | { c: string } | { pl: string } | { sig: [string, string][] };

function blocksHtml(L: Block[]): string {
  return L.map((b) => {
    if ('h' in b) return `<h1 style="text-align:center;font-family:'Times New Roman',serif;font-size:17px;margin:14px 0 2px">${h(b.h)}</h1>`;
    if ('sub' in b) return `<p style="text-align:center;margin:0 0 12px"><b>${h(b.sub)}</b></p>`;
    if ('c' in b) return `<p style="text-align:center;margin:10px 0 4px"><b>${h(b.c)}</b></p>`;
    if ('pl' in b) return `<p style="white-space:pre-line">${h(b.pl)}</p>`;
    if ('sig' in b) return `<div style="display:flex;justify-content:space-between;gap:30px;margin-top:30px;page-break-inside:avoid">${b.sig.map(([t, n]) => `<div style="text-align:center;min-width:60mm">${t ? `<b>${h(t)}</b>` : ''}<div style="border-top:1px solid #111;margin-top:40px;padding-top:3px;white-space:pre-line">${h(n)}</div></div>`).join('')}</div>`;
    return `<p style="text-align:justify">${h(b.p)}</p>`;
  }).join('');
}

/** Disciplinary measure / termination document (legacy `diDoc`): title + blocks. */
export function diDoc(f: DocFirm, e: DocEmployee & { ctNo?: string | null }, x: HrDiDoc): { t: string; b: Block[] } {
  const head: Block[] = [{ pl: `${f.name}\nБрој: ${x.no || '______'}\nДатум: ${D(x.date)} година` }];
  const emp = `${e.name}, ЕМБГ ${e.embg || '____________________'}, вработен/а на работното место ${e.position || '____________________'}`;
  const viol = (x.viol || []).map((v, i) => `${i + 1}) ${v}`).join('; ');
  const sg: Block[] = [{ sig: [['', `${f.name}\n${f.signer}, ${f.signerRole}`]] }];
  const recv: Block[] = [{ pl: 'Примено од работникот на ден ______________ година.' }, { sig: [['Работник', e.name]] }];
  const law = 'Законот за работните односи';
  const ct = e.ctNo ? ' бр. ' + e.ctNo : '';
  const U = '________________________________________________';
  if (x.kind === 'warn') return { t: 'Писмено предупредување', b: [...head, { h: 'ПИСМЕНО ПРЕДУПРЕДУВАЊЕ' }, { sub: 'пред отказ на договорот за вработување' },
    { p: `До: ${emp}.` }, { p: `Врз основа на ${law}, работодавачот Ве предупредува дека не ги исполнувате обврските од работниот однос, и тоа:` }, { p: x.facts || U },
    ...(viol ? [{ p: 'Со ова се сторени следните повреди: ' + viol + '.' }] : []),
    { p: `Ве повикуваме во рок од ${x.days || 15} дена од приемот на ова предупредување да ги отстраните недостатоците и уредно да ги извршувате работните обврски.` },
    { p: 'Ве предупредуваме дека доколку повредите се повторат или не се отстранат во наведениот рок, работодавачот може да Ви го откаже договорот за вработување.' }, ...sg, ...recv] };
  if (x.kind === 'mera') {
    const kz = x.mtype === 'kazna';
    return { t: 'Решение за дисциплинска мерка', b: [...head, { p: `Врз основа на ${law}, работодавачот ${f.name} донесе:` }, { h: 'РЕШЕНИЕ' }, { sub: 'за изрекување дисциплинска мерка' },
      { p: `1. На ${emp}, му/ѝ се изрекува дисциплинска мерка ${kz ? `парична казна во висина од ${x.pct || '__'}% од последната исплатена месечна нето плата, во траење од ${x.months || '__'} ${months(x.months || 0)}, која ќе се задржува од платата почнувајќи од платата за ${x.from ? String(x.from).split('-').reverse().join('.') : '________'}` : 'опомена'}.` },
      { p: '2. Мерката се изрекува поради следните повреди на работниот ред и дисциплина и на работните обврски: ' + (viol || '________') + '.' }, { c: 'Образложение' }, { p: x.facts || U },
      { p: 'Работникот беше повикан да се изјасни за повредите' + (x.heard ? ` на ден ${D(x.heard)} година.` : '.') + ' Работодавачот ги ценеше сите околности и одлучи како во диспозитивот.' },
      { c: 'Поука за правна заштита' }, { p: 'Работникот има право на заштита на своите права пред работодавачот и пред надлежниот суд, во роковите утврдени со закон.' }, ...sg, ...recv] };
  }
  if (x.kind === 'otkaz') {
    const g = HR_DI_GR.find((z) => z[0] === x.ground) || HR_DI_GR[0]!;
    const bez = x.ground === 'vina_bez';
    return { t: 'Решение за отказ на договор за вработување', b: [...head, { p: `Врз основа на член 76 и член 74 од ${law}, работодавачот ${f.name} донесе:` }, { h: 'РЕШЕНИЕ' }, { sub: 'за отказ на договорот за вработување' },
      { p: `1. На ${emp}, му/ѝ се откажува договорот за вработување${ct}, поради ${g[1]}.` },
      { p: bez ? `2. Отказот е без отказен рок. Работниот однос престанува на ден ${D(x.last || x.date)} година.` : `2. Отказниот рок изнесува ${x.notice || 1} ${months(x.notice || 1)} и тече од денот по врачувањето на ова решение. Работниот однос престанува на ден ${D(x.last)} година.` },
      { p: '3. Работникот е должен до последниот работен ден да ги предаде работите, документите, опремата, клучевите и пристапите што ги користел, со записник.' },
      { c: 'Образложение' }, { p: x.facts || U }, ...(viol ? [{ p: 'Работникот ги сторил следните повреди: ' + viol + '.' }] : []),
      ...(x.ground === 'licna' || x.ground === 'vina' ? [{ p: `Работникот претходно беше писмено предупреден${x.wref ? ' (' + x.wref + ')' : ''} за неисполнувањето на обврските и за можноста за отказ, но недостатоците не ги отстрани.` }] : []),
      ...(x.ground === 'delovni' ? [{ p: 'Поради наведените деловни причини престанува потребата од вршење на работите на работното место на работникот.' }] : []),
      { c: 'Поука за правна заштита' }, { p: 'Против ова решение работникот има право на заштита пред работодавачот и пред надлежниот суд, во роковите утврдени со закон. Работникот има право да се пријави во Агенцијата за вработување и да ги оствари правата од осигурување во случај на невработеност, под условите утврдени со закон.' }, ...sg, ...recv] };
  }
  if (x.kind === 'spog') return { t: 'Спогодба за раскинување на договор за вработување', b: [{ h: 'СПОГОДБА' }, { sub: 'за раскинување на договорот за вработување' },
    { p: `Склучена на ден ${D(x.date)} година помеѓу ${f.name}, застапувано од ${f.signer}, ${f.signerRole} (работодавач), и ${emp} (работник).` },
    { c: 'Член 1' }, { p: `Страните спогодбено го раскинуваат договорот за вработување${ct}, согласно член 69 од ${law}. Работниот однос престанува на ден ${D(x.last || x.date)} година.` },
    { c: 'Член 2' }, { p: 'Работникот изјавува дека е запознаен со последиците од спогодбеното раскинување, а особено дека во случај на спогодбено раскинување нема право на паричен надоместок од осигурување во случај на невработеност.' },
    { c: 'Член 3' }, { p: `${+(x.sev || 0) ? `Работодавачот на работникот му исплаќа еднократен износ од ${fmt(+x.sev!)} денари. ` : ''}Страните ги подмируваат меѓусебните обврски (плата, неискористен годишен одмор и др.) до денот на престанокот. Работникот до последниот работен ден ги предава работите, документите, опремата и пристапите, со записник.` },
    { c: 'Член 4' }, { p: 'Спогодбата е составена во 2 (два) еднакви примероци, по еден за секоја страна, и ја потпишуваат страните својерачно, со наведување на името и датумот.' },
    { sig: [['Работник', `${e.name}\nДатум: ______________`], ['Работодавач', `${f.signer}, ${f.signerRole}\nДатум: ______________`]] }] };
  if (x.kind === 'quit') return { t: 'Потврда за прием на отказ од работникот', b: [...head, { h: 'ПОТВРДА' }, { sub: 'за прием на отказ од работникот' },
    { p: `Работодавачот ${f.name} потврдува дека на ден ${D(x.recv || x.date)} година прими писмен отказ на договорот за вработување од ${emp}, согласно член 71 од ${law}.` },
    { p: `Отказниот рок изнесува ${x.notice || 1} ${months(x.notice || 1)}, а работниот однос престанува на ден ${D(x.last)} година${x.short ? ', по договор на страните за пократок отказен рок' : ''}.` },
    { p: 'Работникот до последниот работен ден ги предава работите, документите, опремата и пристапите, со записник.' }, ...sg, ...recv] };
  return { t: 'Известување за престанок поради истек на времето', b: [...head, { h: 'ИЗВЕСТУВАЊЕ' }, { sub: 'за престанок на работниот однос поради истек на времето' },
    { p: `Ве известуваме дека договорот за вработување на определено време${ct} на ${emp}, склучен до ${D(x.last || e.end)} година, нема да се продолжи, па работниот однос престанува со истекот на времето за кое е склучен (член 62 од ${law}), на ден ${D(x.last || e.end)} година.` },
    { p: 'Работникот до последниот работен ден ги предава работите, документите, опремата и пристапите, со записник.' }, ...sg, ...recv] };
}

export function diHtml(f: DocFirm, e: DocEmployee & { ctNo?: string | null }, x: HrDiDoc, code: string): string {
  const d = diDoc(f, e, x);
  return docHead(f, code) + `<div style="font-family:Times New Roman,serif;font-size:12pt;line-height:1.45">${blocksHtml(d.b)}</div>` + docFoot(code, d.t + ' – ' + e.name + '.');
}

/** Annual-leave decision (решение за користење годишен одмор) — registry kind `leave`. */
export function leaveHtml(f: DocFirm, e: DocEmployee, d: { no: string; date: string; start?: string | null; end?: string | null; days?: number | string | null; year?: string }, code: string): string {
  const b: Block[] = [{ pl: `${f.name}\nБрој: ${d.no}\nДатум: ${D(d.date)} година` }, { p: `Врз основа на Законот за работните односи, работодавачот ${f.name} донесе:` },
    { h: 'РЕШЕНИЕ' }, { sub: 'за користење годишен одмор' },
    { p: `1. На ${e.name}, ЕМБГ ${e.embg || '____________________'}, вработен/а на работното место ${e.position || '____________________'}, му/ѝ се одобрува користење на годишен одмор${d.year ? ' за ' + d.year + ' година' : ''} во траење од ${d.days || '__'} работни дена.` },
    { p: `2. Годишниот одмор ќе се користи од ${D(d.start)} до ${D(d.end)} година.` },
    { p: '3. За време на годишниот одмор работникот има право на надоместок на плата согласно закон и колективен договор.' },
    { sig: [['', `${f.name}\n${f.signer}, ${f.signerRole}`]] }, { pl: 'Примено од работникот на ден ______________ година.' }, { sig: [['Работник', e.name]] }];
  return docHead(f, code, false) + `<div style="font-family:Times New Roman,serif;font-size:12pt;line-height:1.45">${blocksHtml(b)}</div>` + docFoot(code, 'Решение за годишен одмор – ' + e.name + '.');
}

/** Sick-leave record (евиденција на боледување) — registry kind `sick`. */
export function sickHtml(f: DocFirm, e: DocEmployee, d: { no: string; date: string; start?: string | null; end?: string | null; days?: number | string | null; note?: string }, code: string): string {
  const b: Block[] = [{ pl: `${f.name}\nБрој: ${d.no}\nДатум: ${D(d.date)} година` }, { h: 'ЕВИДЕНЦИЈА' }, { sub: 'за отсуство поради боледување' },
    { p: `Работникот ${e.name}, ЕМБГ ${e.embg || '____________________'}, отсуствуваше од работа поради привремена спреченост за работа од ${D(d.start)} до ${D(d.end)} година (${d.days || '__'} работни дена).` },
    ...(d.note ? [{ p: d.note }] : []),
    { p: 'Надоместокот на плата за првите 30 дена е на товар на работодавачот, а од 31-виот ден на товар на ФЗО, согласно Законот за здравствено осигурување.' },
    { sig: [['', `${f.name}\n${f.signer}, ${f.signerRole}`]] }];
  return docHead(f, code, false) + `<div style="font-family:Times New Roman,serif;font-size:12pt;line-height:1.45">${blocksHtml(b)}</div>` + docFoot(code, 'Боледување – ' + e.name + '.');
}
