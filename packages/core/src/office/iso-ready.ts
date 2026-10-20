/**
 * „Подготвеност за сертификација“: per standard (ISO 9001, ISO/IEC 27001, ISO/IEC 27701 + ЗЗЛП, ISO 22301) every
 * documented information and record the certifier asks for, computed from the registers – ✓ ready / ◐ partly / ✗
 * missing, with what is missing and where to fill it in. Pure.
 */
import { bcpStatus, breach72, isoStarterDocs, type IsoRow } from './iso';
import { ISO_DOC } from './iso-docs';
import type { SoaControl } from './iso-soa';
import { soaSummary } from './iso-soa';
import type { StaffStatus } from './iso-staff';

export type ReadyState = 'ok' | 'part' | 'miss';
export interface ReadyItem { id: string; clause: string; n: string; state: ReadyState; note: string; href: string }
export interface ReadySection { std: string; n: string; items: ReadyItem[]; pct: number }
export interface ReadyCtx {
  R: readonly IsoRow[];
  soa: readonly (SoaControl & { confirmed: boolean })[];
  staff: readonly { name: string; s: StaffStatus }[];
  /** The ЗЗЛП register (`isoGdprLinks`) and the active clients (without the office). */
  gdpr: { dpa: number; activities: number; statements: number; requests: { late: number }; breaches: { late: number } };
  clients: number;
  /** Clients with a service contract (ISO 9001 §8.2.3). */
  clientContracts: number;
  year: number;
  today: string;
}

const STARTER = new Map(isoStarterDocs('').map((d) => [d.docNo, d.title]));

export function isoReadiness(c: ReadyCtx): ReadySection[] {
  const { R, year, today } = c;
  const of = (k: string) => R.filter((r) => r.kind === k);
  const it = (id: string, clause: string, n: string, state: ReadyState, note: string, href: string): ReadyItem => ({ id, clause, n, state, note, href });
  const tri = (ok: boolean, part: boolean): ReadyState => (ok ? 'ok' : part ? 'part' : 'miss');

  /** A document by its mark (or its starting title): approved and in force, still a draft, or missing. */
  const doc = (code: string, clause: string, n?: string): ReadyItem => {
    const r = of('policy').find((x) => x.data.docNo === code) ?? of('policy').find((x) => x.title === STARTER.get(code));
    const name = n ?? STARTER.get(code) ?? code;
    if (!r) return it(`doc:${code}`, clause, name, 'miss', `документот ${code} не постои – „📘 Додај ги основните документи“`, '/iso?k=policy');
    const href = `/iso?k=policy&id=${r.id}`;
    if (!r.data.approvedOn || r.status !== 'done') return it(`doc:${code}`, clause, name, 'part', 'нацрт – прегледајте, внесете „Одобрил / Одобрено на“ и ставете го во сила', href);
    if (r.data.reviewOn && String(r.data.reviewOn) < today) return it(`doc:${code}`, clause, name, 'part', `рокот за преглед помина (${String(r.data.reviewOn).split('-').reverse().join('.')})`, href);
    return it(`doc:${code}`, clause, name, 'ok', `в. ${String(r.data.version ?? '')} · одобрено ${String(r.data.approvedOn).split('-').reverse().join('.')}`, href);
  };

  // shared parts
  const P = of('policy'), unapproved = P.filter((r) => !r.data.approvedOn || r.status !== 'done' || !r.data.docNo);
  const docCtl = it('7.5', '§7.5', 'Контрола на документите (ознака, верзија, одобрување, историја)', tri(!!P.length && !unapproved.length, P.length > 0), P.length ? (unapproved.length ? `${unapproved.length} од ${P.length} документи без ознака или неодобрени` : `${P.length} документи во сила`) : 'нема документи', '/iso?k=policy');
  const risks = of('risk'), riskOpen = risks.filter((r) => r.status !== 'done');
  const scored = risks.filter((r) => Number(r.data.p) && Number(r.data.i));
  const untreated = riskOpen.filter((r) => !r.data.treatment || !r.data.option);
  const unaccepted = risks.filter((r) => r.data.treatment && !r.data.accepted);
  const objY = of('objective').filter((r) => r.year === year || r.status !== 'done');
  const objOk = (std?: string) => objY.filter((r) => r.data.target && r.data.measure && r.data.plan && (!std || String(r.data.std ?? '').includes(std)));
  const planY = of('auditplan').filter((r) => String(r.data.month ?? '').startsWith(String(year)) || r.year === year);
  const auditsY = of('audit').filter((r) => r.year === year);
  const duePlans = planY.filter((p) => String(p.data.month ?? '') <= today);
  const notDone = duePlans.filter((p) => !auditsY.some((a) => a.data.plan === p.id && a.status === 'done'));
  const auditStd = (std: string) => planY.some((p) => String(p.data.std ?? '').includes(std) || String(p.data.std ?? '').startsWith('интегрирано'));
  const prog = it('9.2', '§9.2', 'Програма и резултати од внатрешните проверки', tri(!!planY.length && !notDone.length && auditsY.some((a) => a.status === 'done'), planY.length > 0),
    planY.length ? `${planY.length} планирани, ${auditsY.filter((a) => a.status === 'done').length} извршени${notDone.length ? `, ${notDone.length} во доцнење` : ''}` : `нема програма за ${year} – „🗓 Додај ја програмата“`, '/iso?k=auditplan');
  const revY = of('review').filter((r) => r.year === year || String(r.data.date ?? '').startsWith(String(year)));
  const review = it('9.3', '§9.3', 'Преглед од раководството (записник со одлуки)', tri(revY.some((r) => r.status === 'done'), revY.length > 0), revY.length ? (revY.some((r) => r.status === 'done') ? 'одржан и потпишан' : 'започнат, не е затворен') : `не е одржан во ${year} – 🖨 извештајот + запис во „Прегледи од раководството“`, '/iso?k=review');
  const ncs = of('nc'), ncLate = ncs.filter((r) => r.status !== 'done' && r.due && r.due < today), ncNoEff = ncs.filter((r) => r.status === 'done' && r.data.effective !== 'да');
  const nc = it('10.2', '§10.2', 'Неусогласености и корективни мерки со проверка на ефективноста', tri(!ncLate.length && !ncNoEff.length, true), ncs.length ? `${ncs.length} записи${ncLate.length ? `, ${ncLate.length} по рокот` : ''}${ncNoEff.length ? `, ${ncNoEff.length} затворени без проверка на ефективноста` : ''}` : 'нема записи (секоја грешка / наод се запишува)', '/iso?k=nc');
  const staffAll = c.staff.length, staffOk = c.staff.filter((x) => x.s.ok).length;
  const comp = c.staff.filter((x) => x.s.training === 'ok').length;
  const evalMissing = of('training').filter((r) => !r.data.evaluation || r.data.evaluation === 'не е оценето');
  const competence = it('7.2', '§7.2', 'Компетентност – обуки со оценка', tri(staffAll > 0 && comp === staffAll && !evalMissing.length, comp > 0 || of('training').length > 0), `${comp} / ${staffAll} вработени со обука во последните 12 месеци${evalMissing.length ? `, ${evalMissing.length} обуки без оценка на компетентноста` : ''}`, '/iso?k=training');
  const ackOk = c.staff.filter((x) => x.s.policies === 'ok').length;
  const awareness = it('7.3', '§7.3', 'Свесност – изјава за прифаќање на важечките политики', tri(staffAll > 0 && ackOk === staffAll, ackOk > 0), `${ackOk} / ${staffAll} вработени ги прифатиле важечките верзии`, '/iso?k=staff');
  const sup = of('supplier'), supNoEval = sup.filter((r) => !r.data.evaluation || (r.data.nextOn && String(r.data.nextOn) < today));

  const q: ReadyItem[] = [
    doc(ISO_DOC.context, '§4.1'), doc(ISO_DOC.parties, '§4.2'), doc(ISO_DOC.scope, '§4.3'),
    doc(ISO_DOC.qPolicy, '§5.2'), doc(ISO_DOC.roles, '§5.3'),
    it('6.1', '§6.1', 'Ризици и можности со мерки', tri(risks.length > 0 && !untreated.length, risks.length > 0), risks.length ? `${risks.length} ризици${untreated.length ? `, ${untreated.length} без мерка / опција` : ''}` : 'нема ризици', '/iso?k=risk'),
    it('6.2', '§6.2', 'Цели на квалитетот (мерливи, со план, ресурси и оценка)', tri(objOk('9001').length > 0, objY.length > 0), objY.length ? `${objOk('9001').length} целосни цели за квалитет од ${objY.length}` : `нема цели за ${year}`, '/iso?k=objective'),
    competence, awareness, doc(ISO_DOC.comms, '§7.4'), docCtl, doc(ISO_DOC.docControl, '§7.5.3'),
    it('8.2.3', '§8.2.3', 'Преглед на барањата за услугите – договор со секој клиент', tri(c.clients > 0 && c.clientContracts >= c.clients, c.clientContracts > 0), `${c.clientContracts} / ${c.clients} клиенти со договор за услуги`, '/kdogovori'),
    it('8.4', '§8.4', 'Оценка на надворешните добавувачи', tri(sup.length > 0 && !supNoEval.length, sup.length > 0), sup.length ? `${sup.length} добавувачи${supNoEval.length ? `, ${supNoEval.length} неоценети / за повторна оценка` : ''}` : 'нема добавувачи – „🤝 Додај ги основните“', '/iso?k=supplier'),
    doc(ISO_DOC.complaints, '§9.1.2 · ISO 10002'), doc(ISO_DOC.code10001, 'ISO 10001'),
    it('9.1', '§9.1', 'Мерење – постигнатото кај целите, задоволство на клиентите', tri(objY.some((r) => r.data.value), objY.length > 0), objY.some((r) => r.data.value) ? 'внесени резултати' : 'внесете „Постигнато“ кај целите', '/iso?k=objective'),
    prog, doc(ISO_DOC.audits, '§9.2'), review, doc(ISO_DOC.nc, '§10.2'), nc,
  ];

  const S = soaSummary(c.soa);
  const soaDoc = doc(ISO_DOC.soa, '§6.1.3 d');
  const restore = of('bctest').filter((r) => r.data.type === 'тест на враќање од резервна копија' && r.data.result === 'успешно');
  const lastRestore = restore.map((r) => String(r.data.date ?? '')).sort().at(-1) ?? '';
  const halfYear = new Date(Date.parse(`${today}T00:00:00Z`) - 183 * 864e5).toISOString().slice(0, 10);
  const i: ReadyItem[] = [
    doc(ISO_DOC.scope, '§4.3'), doc(ISO_DOC.isPolicy, '§5.2'), doc(ISO_DOC.roles, '§5.3'), doc(ISO_DOC.riskMethod, '§6.1.2'),
    it('8.2', '§8.2', 'Резултати од проценката на ризиците (веројатност × влијание)', tri(scored.length > 0 && scored.length === risks.length, scored.length > 0), `${scored.length} / ${risks.length} ризици оценети`, '/iso?k=risk'),
    it('8.3', '§6.1.3 · §8.3', 'Третман на ризиците и прифаќање од сопственикот', tri(risks.length > 0 && !untreated.length && !unaccepted.length, risks.length > 0), `${untreated.length} без третман, ${unaccepted.length} без прифаќање на преостанатиот ризик`, '/iso?k=risk'),
    it('soa', '§6.1.3 d', 'Изјава за применливост – сите 93 контроли потврдени', tri(S.confirmed === S.total && soaDoc.state === 'ok', S.confirmed > 0 || soaDoc.state !== 'miss'), `${S.confirmed} / ${S.total} потврдени · применливи ${S.applicable}, спроведени ${S.done}, делумно ${S.partial}, планирани ${S.planned}${soaDoc.state === 'ok' ? '' : ' · документот СУ-06 не е одобрен'}`, '/iso?k=soa'),
    it('soa-impl', 'Анекс А', 'Спроведување на применливите контроли', tri(S.applicable > 0 && S.done === S.applicable, S.done > 0), `${S.done} / ${S.applicable} спроведени (делумно ${S.partial}, планирано ${S.planned})`, '/iso?k=soa'),
    it('6.2', '§6.2', 'Цели за безбедност на информациите', tri(objOk('27001').length > 0, objY.length > 0), `${objOk('27001').length} целосни цели за безбедност`, '/iso?k=objective'),
    competence, awareness, doc(ISO_DOC.comms, '§7.4'), docCtl,
    doc(ISO_DOC.aup, 'A.5.10'), doc(ISO_DOC.access, 'A.5.15–5.18 · A.8.13'), doc(ISO_DOC.breach, 'A.5.24–5.28'), doc(ISO_DOC.change, 'A.8.32'), doc(ISO_DOC.hr, 'A.6.1–6.5'),
    it('A.6', 'A.6.1–6.6', 'Вработени: договор со одредби за безбедност, доверливост, политики, пристап', tri(staffAll > 0 && staffOk === staffAll, staffOk > 0 || c.staff.some((x) => x.s.contract !== 'miss')), `${staffOk} / ${staffAll} вработени целосно`, '/iso?k=staff'),
    it('A.5.19', 'A.5.19–5.22', 'Добавувачи – оценка и договори за обработка', tri(sup.length > 0 && !supNoEval.length && !sup.some((r) => r.data.personal === 'да' && r.data.dpa !== 'потпишан / прифатен'), sup.length > 0), `${sup.filter((r) => r.data.personal === 'да' && r.data.dpa !== 'потпишан / прифатен').length} со лични податоци без договор за обработка`, '/iso?k=supplier'),
    it('A.8.13', 'A.8.13', 'Тест на враќање од резервна копија (во последните 6 месеци)', tri(lastRestore >= halfYear, !!lastRestore), lastRestore ? `последен успешен ${lastRestore.split('-').reverse().join('.')}` : 'нема успешен тест на враќање', '/iso?k=bctest'),
    it('A.8.15', 'A.8.15–8.16', 'Дневник на промени и следење на грешките', 'ok', 'програмата ги води автоматски (дневникот не може да се брише)', '/iso?k=ev'),
    { ...prog, n: 'Внатрешна проверка на ISO 27001 во програмата', state: tri(auditStd('27001') && !notDone.length, auditStd('27001')), id: '9.2-27001' }, review, nc,
  ];

  const proc = of('processing'), procBad = proc.filter((r) => !r.data.basis || !r.data.retention || !r.data.purpose);
  const needDpia = proc.filter((r) => r.data.special === 'да' || /САД|трет|надвор/i.test(String(r.data.transfer ?? '')) && !/нема/i.test(String(r.data.transfer ?? '')));
  const dpias = of('dpia');
  const dsrLate = of('dsr').filter((r) => r.due && (r.data.answeredOn ? String(r.data.answeredOn) > r.due : r.status !== 'done' && r.due < today));
  const brLate = of('incident').filter((r) => { const b = breach72(r.data, `${today}T23:59`).state; return b === 'late' || b === 'overdue'; });
  const confOk = c.staff.filter((x) => x.s.confid === 'ok').length;
  const p: ReadyItem[] = [
    doc(ISO_DOC.privacy, '27701 §5.2 · ЗЗЛП'), doc(ISO_DOC.roles, 'ЗЗЛП чл. 41 – офицер за заштита', 'Улоги – офицер за заштита на личните податоци'),
    it('ropa', '27701 §7.2.8 · ЗЗЛП чл. 30', 'Евиденција на обработките (цел, основ, рок, мерки)', tri(proc.length > 0 && !procBad.length, proc.length > 0), proc.length ? `${proc.length} обработки${procBad.length ? `, ${procBad.length} без цел / основ / рок` : ''}` : 'празно – „🗂 Додај ги основните обработки“', '/iso?k=processing'),
    it('dpa', '27701 §8.2.1 · ЗЗЛП чл. 32', 'Договор за обработка со секој клиент', tri(c.clients > 0 && c.gdpr.dpa >= c.clients, c.gdpr.dpa > 0), `${c.gdpr.dpa} / ${c.clients} клиенти`, '/zzlp'),
    it('dpia', '27701 §7.2.5 · ЗЗЛП чл. 39', 'DPIA за ризичните обработки', tri(!needDpia.length || needDpia.every((r) => dpias.some((d) => d.data.processing === r.id)), dpias.length > 0), needDpia.length ? `${needDpia.filter((r) => !dpias.some((d) => d.data.processing === r.id)).length} од ${needDpia.length} ризични обработки (посебни категории / пренос) без DPIA` : 'нема ризични обработки', '/iso?k=dpia'),
    doc(ISO_DOC.dsr, '27701 §7.3'), it('dsr', '27701 §7.3 · ЗЗЛП чл. 19–26', 'Барања од субјекти одговорени во рок', tri(!dsrLate.length && !c.gdpr.requests.late, true), dsrLate.length + c.gdpr.requests.late ? `${dsrLate.length + c.gdpr.requests.late} задоцнети` : 'без задоцнети', '/iso?k=dsr'),
    doc(ISO_DOC.breach, '27701 §6.13 · ЗЗЛП чл. 37'), it('72h', 'ЗЗЛП чл. 37', 'Повреди пријавени на АЗЛП во 72 часа', tri(!brLate.length && !c.gdpr.breaches.late, true), brLate.length + c.gdpr.breaches.late ? `${brLate.length + c.gdpr.breaches.late} задоцнети / непријавени` : 'без задоцнети', '/iso?k=incident'),
    doc(ISO_DOC.retention, '27701 §7.4.7'), doc(ISO_DOC.notice, 'ЗЗЛП чл. 17–18'),
    it('conf', 'ЗЗЛП чл. 36 · A.6.6', 'Вработени – доверливост и овластување за обработка', tri(staffAll > 0 && confOk === staffAll, confOk > 0), `${confOk} / ${staffAll}`, '/iso?k=staff'),
    it('sub', '27701 §8.5.6–8.5.8', 'Подобработувачи со договор за обработка', tri(sup.some((r) => r.data.personal === 'да') && !sup.some((r) => r.data.personal === 'да' && r.data.dpa !== 'потпишан / прифатен'), sup.length > 0), `${sup.filter((r) => r.data.personal === 'да').length} добавувачи со лични податоци`, '/iso?k=supplier'),
    { ...prog, n: 'Внатрешна проверка на ЗЗЛП / ISO 27701', state: tri(auditStd('27701') && !notDone.length, auditStd('27701')), id: '9.2-27701' },
  ];

  const plans = bcpStatus(R, today), bcp = of('bcp');
  const biaBad = bcp.filter((r) => !r.data.impact || r.data.rto == null || r.data.rto === '' || r.data.rpo == null || r.data.rpo === '');
  const noOwner = bcp.filter((r) => !r.ownerId || !r.data.deputy);
  const restoreY = restore.filter((r) => String(r.data.date ?? '').startsWith(String(year)));
  const b: ReadyItem[] = [
    doc(ISO_DOC.scope, '§4.3'), doc(ISO_DOC.bcPlan, '§5.2 · §8.4'),
    it('bia', '§8.2.2', 'Анализа на влијанието (влијание, RTO, RPO по сценарио)', tri(bcp.length > 0 && !biaBad.length, bcp.length > 0), bcp.length ? `${bcp.length} сценарија${biaBad.length ? `, ${biaBad.length} без влијание / RTO / RPO` : ''}` : 'празно – „🧯 Додај ги основните сценарија“', '/iso?k=bcp'),
    it('bc-owner', '§5.3 · §8.4.2', 'Одговорно лице и замена по сценарио', tri(bcp.length > 0 && !noOwner.length, bcp.length > 0), `${noOwner.length} сценарија без одговорно лице или замена`, '/iso?k=bcp'),
    it('exercise', '§8.5', 'Вежби и тестови по сценарио (во рок, исполнети RTO / RPO)', tri(plans.length > 0 && plans.every((x) => x.state === 'ok'), plans.some((x) => x.state === 'ok')), plans.length ? `${plans.filter((x) => x.state === 'ok').length} / ${plans.length} тестирани во рок${plans.some((x) => x.state === 'failed') ? `, ${plans.filter((x) => x.state === 'failed').length} не ги исполниле RTO / RPO` : ''}` : 'нема сценарија', '/iso?k=bctest'),
    it('restore', 'A.8.13 · §8.5', `Тестови на враќање од резервна копија во ${year} (најмалку 2)`, tri(restoreY.length >= 2, restoreY.length > 0), `${restoreY.length} успешни`, '/iso?k=bctest'),
    doc(ISO_DOC.comms, '§8.4.3'),
    { ...prog, n: 'Внатрешна проверка на ISO 22301', state: tri(auditStd('22301') && !notDone.length, auditStd('22301')), id: '9.2-22301' }, review,
  ];

  const pct = (L: ReadyItem[]) => (L.length ? Math.round(L.reduce((s, x) => s + (x.state === 'ok' ? 1 : x.state === 'part' ? 0.5 : 0), 0) / L.length * 100) : 0);
  return [
    { std: '9001', n: 'ISO 9001:2015 – Квалитет', items: q, pct: pct(q) },
    { std: '27001', n: 'ISO/IEC 27001:2022 – Безбедност на информациите', items: i, pct: pct(i) },
    { std: '27701', n: 'ISO/IEC 27701 · ЗЗЛП – Лични податоци', items: p, pct: pct(p) },
    { std: '22301', n: 'ISO 22301 – Континуитет на работењето', items: b, pct: pct(b) },
  ];
}
