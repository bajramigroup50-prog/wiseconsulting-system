/**
 * Payslip (legacy `slipHTML`, only the last replacement at 14837 "v488 variant Б" is live — LEGACY-MAP 6.4 #5),
 * payroll recap (`payRecPdf` 7252), annual report rows (`payGod`) and М4 rows (`m4Rows`).
 * Pure functions: used by the print route handlers and as the body of payslip e-mails.
 *
 * FIX (#1): the recap header printed fallback rates `pr(params,'pio',18.8)` / `vrab 1.2` and a hard-coded
 * "Данок 10%"; the rates now come from the run's resolved params only.
 */
import { empCalc, payCatOf, payBaseSum, type PayEmp, type PayParams } from '@wise/core/payroll';
import { dmy, fmt, fq, h, monthName, mmYYYY, ph, sig } from './html';

export interface SlipFirm {
  name: string;
  edb: string;
  embs: string;
  bankAccount: string;
  activity: string;
}
export interface SlipEmployee {
  start?: string | null;
  stazPrev?: number | string | null;
  position?: string | null;
}

/** Seniority in years / months / days at the end of `month` (legacy `stazYMD` 14803). */
export function stazYMD(E: SlipEmployee | null | undefined, month: string): { y: number; m: number; d: number } {
  const end = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0));
  let y = 0, m = 0, d = 0;
  if (E?.start) {
    const st = new Date(E.start + 'T00:00:00Z');
    y = end.getUTCFullYear() - st.getUTCFullYear();
    m = end.getUTCMonth() - st.getUTCMonth();
    d = end.getUTCDate() - st.getUTCDate() + 1;
    if (d < 0) { m--; d += new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate(); }
    if (m < 0) { y--; m += 12; }
    if (y < 0) { y = 0; m = 0; d = 0; }
    const dim = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    if (d >= dim || (st.getUTCDate() === 1 && d === end.getUTCDate())) { m++; d = 0; }
    if (m >= 12) { y++; m -= 12; }
  }
  const pv = +(E?.stazPrev ?? 0) || 0;
  const py = Math.floor(pv), pm = Math.round((pv - py) * 12);
  y += py; m += pm;
  if (m >= 12) { y += Math.floor(m / 12); m %= 12; }
  return { y, m, d };
}

const nkd = (a: string) => String(a || '').match(/\d{2}\.?\d*/)?.[0] || '';

/** One payslip. `preparedBy` = name printed under "Пресметката ја изготвил". */
export function slipHtml(run: { month: string; params: PayParams }, e: PayEmp, f: SlipFirm, E: SlipEmployee | null, preparedBy = ''): string {
  const P = run.params, c = empCalc(e, P), T = c.T;
  const z = E?.start || E?.stazPrev ? stazYMD(E, run.month) : { y: Math.floor(+(e.stazY ?? 0) || 0), m: 0, d: 0 };
  const cat = (r: { cat?: string; type: string }) => r.cat || payCatOf(r.type);
  const hr = c.rows.filter((r) => r.hr), ad = c.rows.filter((r) => !r.hr && r.gr && cat(r) !== 'sin'), dd = c.rows.filter((r) => r.ded);
  const mt = c.raised ? 0 : Math.max(0, c.Gc - c.base);
  const worked = hr.reduce((a, r) => a + r.hr, 0);
  const G = '#0f5b4a', L = '#e8f3ef', BD = '#d6e4df';
  const chip = (t: string) => `<span style="display:inline-block;background:${L};color:${G};border-radius:6px;padding:2px 8px;font-size:10.5px;margin:2px 4px 0 0">${t}</span>`;
  const kpi = (t: string, v: string) => `<div style="border:1px solid ${BD};border-radius:8px;padding:5px 8px"><div style="color:#5b6b66;font-size:9.5px">${t}</div><div style="font-size:13.5px;font-weight:700">${v}</div></div>`;
  const sec = (t: string) => `<div style="margin-top:9px;font-weight:700;color:${G};font-size:11.5px;border-bottom:1.5px solid ${G};padding-bottom:2px">${t}</div>`;
  const td = 'border:0;border-bottom:1px solid #eef2f0;padding:3px 6px';
  const tr = (a: string, b: string, bold?: boolean) => `<tr><td style="${td}${bold ? ';font-weight:700' : ''}">${a}</td><td class="n" style="${td}${bold ? ';font-weight:700' : ''}">${b}</td></tr>`;
  const th = `style="background:${G};color:#fff;border:0;padding:4px 6px"`;
  const edb = f.edb ? 'MK' + String(f.edb).replace(/\D/g, '') : '';
  return `<div class="slipb"><style>.slipb table{border:0!important;width:100%;border-collapse:collapse}.slipb td,.slipb th{border:0!important;border-bottom:1px solid #eef2f0!important;font-family:inherit!important;font-size:11px!important}.slipb th{background:${G}!important;color:#fff!important;border-bottom:0!important}.slipb .n{text-align:right!important;font-variant-numeric:tabular-nums}</style>`
    + `<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${G};padding-bottom:5px"><div><div style="font-size:13px;font-weight:700">${h(String(f.name || '').toUpperCase())}</div><div style="font-size:9.5px;color:#5b6b66">ЕДБ ${h(edb)} · ЕМБС ${h(f.embs)} · Ж-с ${h(f.bankAccount)} · Дејност ${h(nkd(f.activity))}</div></div><div style="text-align:right"><div style="font-size:20px;font-weight:800;color:${G};letter-spacing:.05em">ПРЕСМЕТКА НА ПЛАТА</div><div style="font-size:11.5px">${h(monthName(run.month))}</div></div></div>`
    + `<div style="margin-top:7px"><b style="font-size:14px">${h(e.no)} ${h(e.name)}</b>${E?.position ? ` <span style="color:#5b6b66;font-size:11px">· ${h(E.position)}</span>` : ''}<br>${e.embg ? chip('ЕМБГ ' + h(e.embg)) : ''}${chip('Стаж ' + z.y + ' год. ' + z.m + ' мес.' + (z.d ? ' ' + z.d + ' д.' : ''))}${chip('Основна нето ' + fmt(e.netBase as number))}${chip('Коеф. ' + fq((e.coef as number) || 1))}${+(e.hNorm ?? 0) && +(e.hNorm ?? 0) < +(P.hours ?? 0) ? chip('Скратено време ' + fq(e.hNorm as number) + ' ч') : ''}</div>`
    + `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:9px 0">${kpi('Работни часови (фонд)', fq(c.H))}${kpi('Одработени часови', fq(worked))}${kpi('Бруто плата', fmt(T.gross))}${kpi('Минат труд', fmt(mt) + (c.mt ? ' <small style="font-weight:400;color:#5b6b66">(' + fq(c.mt) + '%)</small>' : ''))}</div>`
    + (c.raised ? `<div style="font-size:10px;color:#8a5a00;margin:-3px 0 4px">Бруто платата е покачена на минималната (${fmt(c.Gf)}).</div>` : '')
    + `${sec('Заработка')}<table style="margin:0"><tr><th ${th} align="left">Опис</th><th ${th} class="n">Часови</th><th ${th} class="n">%</th><th ${th} class="n">Износ</th></tr>`
    + hr.map((r) => `<tr><td style="${td}">${h(r.type)}</td><td class="n" style="${td}">${fq(r.hr)}</td><td class="n" style="${td}">${r.pc}%</td><td class="n" style="${td}">${fmt(r.gr)}</td></tr>`).join('')
    + ad.map((r) => `<tr><td style="${td}">${h(r.type)}</td><td style="${td}"></td><td style="${td}"></td><td class="n" style="${td}">${fmt(r.gr)}</td></tr>`).join('')
    + `<tr><td style="border:0;padding:3px 6px;font-weight:700">Вкупно бруто</td><td style="border:0"></td><td style="border:0"></td><td class="n" style="border:0;padding:3px 6px;font-weight:700">${fmt(T.gross)}</td></tr></table>`
    + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div>${sec('Придонеси')}<table style="margin:0">${tr('ПИО ' + fq(P.pio) + '%', fmt(T.pio))}${tr('Здравство ' + fq(P.zdr) + '%', fmt(T.zdr))}${tr('Дополнително здравствено ' + fq(P.dop) + '%', fmt(T.dop))}${tr('Вработување ' + fq(P.vrab) + '%', fmt(T.vrab))}${T.dopl ? tr('Доплата до најниска основица (работодавач)', fmt(T.dopl)) : ''}${tr('Вкупно придонеси', fmt(T.contr), true)}</table></div>`
    + `<div>${sec('Данок')}<table style="margin:0">${tr('Даночно ослободување', fmt(T.ex))}${tr('Даночна основа', fmt(Math.max(0, T.gross - T.contr - T.ex)))}${tr('Персонален данок ' + fq(P.tax) + '%', fmt(T.tax))}</table>${dd.length ? sec('Задршки') + '<table style="margin:0">' + dd.map((r) => tr(h(r.type), fmt(r.ded))).join('') + '</table>' : ''}</div></div>`
    + `<div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;background:${G};color:#fff;border-radius:10px;padding:9px 14px"><span style="font-size:13px">НЕТО ЗА ИСПЛАТА</span><b style="font-size:20px">${fmt(T.net)} ден.</b></div>`
    + `<div style="display:flex;gap:12mm;margin-top:10mm;font-size:10.5px;text-align:center;align-items:flex-start"><div style="flex:1"><div style="height:18mm"></div><div style="border-top:1px solid #111;padding-top:2px">Пресметката ја изготвил${preparedBy ? '<br><b>' + h(preparedBy) + '</b>' : ''}</div></div><div style="flex:1"><div style="height:18mm"></div><div style="border-top:1px solid #111;padding-top:2px">Примил</div></div><div style="flex:1"><div style="height:18mm"></div><div style="border-top:1px solid #111;padding-top:2px">Раководител · М.П.</div></div></div></div>`;
}

/** Payroll recap of the month (legacy `payRecPdf`), landscape. */
export function recapHtml(run: { month: string; params: PayParams; emps: readonly PayEmp[] }, f: { name: string; edb: string }): string {
  const P = run.params;
  const cs = run.emps.map((e) => ({ e, c: empCalc(e, P) }));
  const T = (k: keyof ReturnType<typeof empCalc>['T']) => fmt(cs.reduce((s, x) => s + x.c.T[k], 0));
  return ph(f, 'РЕКАПИТУЛАР НА ПЛАТИ', 'Месец ' + mmYYYY(run.month) + ' · работни часови ' + fq(P.hours ?? 0))
    + `<table><thead><tr><th>Бр.</th><th>Вработен</th><th class="n">Часови</th><th class="n">Бруто</th><th class="n">ПИО ${fq(P.pio)}%</th><th class="n">Здравство ${fq(P.zdr)}%</th><th class="n">Доп. здр. ${fq(P.dop)}%</th><th class="n">Вработување ${fq(P.vrab)}%</th><th class="n">Ослободување</th><th class="n">Данок ${fq(P.tax)}%</th><th class="n">Нето</th><th class="n">Доплата</th></tr></thead><tbody>`
    + cs.map(({ e, c }) => `<tr><td>${h(e.no)}</td><td>${h(e.name)}</td><td class="n">${fq(c.T.hours)}</td><td class="n">${fmt(c.T.gross)}</td><td class="n">${fmt(c.T.pio)}</td><td class="n">${fmt(c.T.zdr)}</td><td class="n">${fmt(c.T.dop)}</td><td class="n">${fmt(c.T.vrab)}</td><td class="n">${fmt(c.T.ex)}</td><td class="n">${fmt(c.T.tax)}</td><td class="n">${fmt(c.T.net)}</td><td class="n">${c.T.dopl ? fmt(c.T.dopl) : ''}</td></tr>`).join('')
    + `</tbody><tfoot><tr><td colspan="2">Вкупно</td><td class="n">${fq(cs.reduce((s, x) => s + x.c.T.hours, 0))}</td><td class="n">${T('gross')}</td><td class="n">${T('pio')}</td><td class="n">${T('zdr')}</td><td class="n">${T('dop')}</td><td class="n">${T('vrab')}</td><td class="n">${T('ex')}</td><td class="n">${T('tax')}</td><td class="n">${T('net')}</td><td class="n">${T('dopl')}</td></tr></tfoot></table>`
    + sig('Пресметката ја изготвил', 'Раководител');
}

export interface YearRow { key: string; no: string; name: string; embg: string; m: Record<string, { g: number; n: number; h: number; t: number; c: number }> }

/** Per-employee month values of the year's runs (legacy `VIEWS.payGod`). */
export function yearRows(runs: readonly { month: string; params: PayParams; emps: readonly PayEmp[] }[]): YearRow[] {
  const E = new Map<string, YearRow>();
  for (const p of runs) for (const e of p.emps) {
    const c = empCalc(e, p.params);
    const k = e.empId || e.name;
    const o = E.get(k) ?? E.set(k, { key: k, no: e.no ?? '', name: e.name, embg: e.embg ?? '', m: {} }).get(k)!;
    o.m[p.month.slice(5, 7)] = { g: c.T.gross + c.T.dopl, n: c.T.net, h: c.T.hours, t: c.T.tax, c: c.T.contr + c.T.dopl };
  }
  return [...E.values()];
}

export interface M4Row { no: string; name: string; embg: string; months: string[]; hours: number; gross: number; base: number; pio: number }

/** Annual М4 data per insured person (legacy `m4Rows`). */
export function m4Rows(runs: readonly { month: string; params: PayParams; emps: readonly PayEmp[] }[], embgOf: (empId: string) => string = () => ''): M4Row[] {
  const E = new Map<string, M4Row>();
  for (const p of runs) for (const e of p.emps) {
    const c = empCalc(e, p.params);
    const k = e.empId || e.name;
    const o = E.get(k) ?? E.set(k, { no: e.no ?? '', name: e.name, embg: e.embg || embgOf(e.empId), months: [], hours: 0, gross: 0, base: 0, pio: 0 }).get(k)!;
    if (!o.months.includes(p.month)) o.months.push(p.month);
    o.hours += c.T.hours;
    o.gross += c.T.gross + c.T.dopl;
    o.base += payBaseSum(c);
    o.pio += c.T.pio + c.T.dPio;
  }
  return [...E.values()].map((o) => ({ ...o, months: o.months.sort() }));
}

export { dmy };
