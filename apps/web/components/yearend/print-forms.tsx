/**
 * Official print layouts of the year-end (HTML for the browser's print-to-PDF; server-side PDF is Phase 9):
 *  - `OffForm`  legacy `zsOffHTML` 10696 — the prescribed paper form of Биланс на состојба / успех
 *  - `CrmForm`  legacy `zsCrmHTML` 10727 — the ЦРМ e-annual-account layout
 *  - `DbForm`   legacy `dbFormHTML` 10844 — УЈП ДБ (6-2020)
 *  - `VpForm`   legacy `vpFormHTML` 17109 — УЈП ДБ-ВП
 *  - `BelPrint` legacy `belPdf` 10934 — explanatory notes
 * FIX(P8 #4/#6): one definition each (legacy hoisting left dead `zsPdfTable` copies and three `ACT.zsPdf`).
 */
import { DB_F, belResolve, dbEdb, type BelFirm, type DbResult, type VpResult, type ZsRule } from '@wise/core';
import type { Firm } from '@wise/db';
import { dmy } from '@/lib/fmt';

export interface Signers { rep: string; office: string; lic: string; officeEdb: string; signer: string; signerRole: string }

const S = (f: Firm) => (f.settings ?? {}) as Record<string, string | undefined>;
export const belFirm = (f: Firm): BelFirm => ({
  name: f.name, legalForm: f.legalForm, embs: f.embs, edb: f.edb, address: f.address, city: f.city, activity: f.activity, signer: S(f).signer ?? null,
});
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' });
const fi = (v: number) => Math.round(v).toLocaleString('de-DE');
const amt = (v: number | undefined) => { const n = Math.round(+(v ?? 0) || 0); return n ? fi(n) : ''; };
const Css = ({ css }: { css: string }) => <style dangerouslySetInnerHTML={{ __html: css }} />;

/* ---------------- Биланс — пропишан образец ---------------- */

const OFF_CSS = `.zo{font-family:"Times New Roman",Georgia,serif;color:#000}.zo .zid{width:auto;border:0;margin:0 0 6px;font-size:10.5px}.zo .zid td{border:0;padding:1px 6px 1px 0}.zo .zid td.v{border-bottom:.6px solid #000;min-width:70mm;font-weight:700}
.zo h1{text-align:center;font-size:15px;letter-spacing:.06em;margin:10px 0 0}.zo .zs{text-align:center;font-size:11px;margin:2px 0 4px}.zo .den{text-align:right;font-size:9.5px;font-style:italic;margin:0 0 2px}
.zo table.zt{border:1px solid #000;font-size:9.5px}.zo table.zt th{border:.7px solid #000;text-align:center;font-weight:700;padding:3px 3px;vertical-align:middle;letter-spacing:0}.zo table.zt td{border:.7px solid #000;padding:2px 4px}
.zo table.zt tr.cn th{font-weight:400;font-size:8.5px;padding:1px}.zo td.c{text-align:center}.zo td.a{text-align:right;font-family:"Times New Roman",serif;white-space:nowrap}.zo tr.b td{font-weight:700}.zo tr.b0 td{font-weight:700;background:#f2f2f2}
.zo .zf{display:flex;justify-content:space-between;gap:16px;margin-top:22px;font-size:10px}.zo .zf div{width:46%;text-align:center}.zo .zf .ln{border-top:.7px solid #000;margin-top:26px;padding-top:2px}.zo .mp{text-align:center;font-size:10px;margin-top:6px}`;

const isF = (f: string) => !!f && /^[\d+\-\s]+$/.test(f);
const withFormula = (x: ZsRule) => { let n = String(x.n || ''); if (x.f && isF(x.f) && !/\(\s*\d{3}/.test(n)) n += ' (' + x.f.replace(/\s/g, '') + ')'; return n; };

export function OffForm({ rep, rules, cur, prev, firm, year, sig }: {
  rep: 'bs' | 'bu'; rules: readonly ZsRule[]; cur: Record<string, number>; prev: Record<string, number>; firm: Firm; year: number; sig: Signers;
}) {
  const isB = rep === 'bs';
  const t = isB ? 'БИЛАНС НА СОСТОЈБА' : 'БИЛАНС НА УСПЕХ';
  const R = rules.filter((x) => x.r === rep);
  const lvl = (n: string) => (/^(АКТИВА|ПАСИВА|ВОНБИЛАНСНА)/i.test(n) || /^[А-Ш]\.\s?/.test(n) ? 0 : /^[IVX]+\.\s?/.test(n) ? 1 : 2);
  return (
    <div className="zo">
      <Css css={OFF_CSS} />
      <table className="zid"><tbody>
        <tr><td>Назив на субјектот:</td><td className="v">{firm.name}</td></tr>
        <tr><td>Седиште и адреса:</td><td className="v">{[firm.address, firm.city].filter(Boolean).join(', ')}</td></tr>
        <tr><td>ЕМБС:</td><td className="v">{firm.embs}</td></tr>
        <tr><td>ЕДБ:</td><td className="v">{dbEdb(firm.edb)}</td></tr>
        <tr><td>Шифра на дејност:</td><td className="v">{firm.activity}</td></tr>
      </tbody></table>
      <h1>{t}</h1>
      <div className="zs">{isB ? `на ден 31.12.${year} година` : `за периодот од 01.01.${year} до 31.12.${year} година`}</div>
      <div className="den">(во денари)</div>
      <table className="zt">
        <thead>
          <tr><th rowSpan={2} style={{ width: '9mm' }}>Р. бр.</th><th rowSpan={2}>П О З И Ц И Ј А</th><th rowSpan={2} style={{ width: '15mm' }}>Ознака за АОП</th><th rowSpan={2} style={{ width: '14mm' }}>Број на белешка</th><th colSpan={2}>И з н о с</th></tr>
          <tr><th style={{ width: '26mm' }}>Тековна година</th><th style={{ width: '26mm' }}>Претходна година</th></tr>
          <tr className="cn"><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th></tr>
        </thead>
        <tbody>
          {R.map((x, i) => {
            const L = lvl(x.n);
            const b = L < 2 || isF(x.f) || /^(ДОБИВКА|ЗАГУБА|НЕТО|ВКУПНА|ВКУПНО)/.test(String(x.n).trim());
            return (
              <tr key={x.aop} className={L === 0 ? 'b0' : b ? 'b' : ''}>
                <td className="c">{i + 1}</td><td style={{ paddingLeft: L === 2 ? 14 : 4 }}>{withFormula(x)}</td><td className="c">{x.aop}</td><td className="c" />
                <td className="a">{amt(cur[rep + x.aop])}</td><td className="a">{amt(prev[rep + x.aop])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="zf"><div>Во {firm.city || '__________'}, на {dmy(today())} година</div><div /></div>
      <div className="zf">
        <div>Лице одговорно за составување<br />на финансиските извештаи<div className="ln">{sig.rep}{sig.office && <><br />{sig.office}</>}{sig.lic && <><br />Регистарски број: {sig.lic}</>}</div></div>
        <div>Одговорно лице<br />{sig.signerRole}<div className="ln">{sig.signer}</div></div>
      </div>
      <div className="mp">М.П.</div>
    </div>
  );
}

/* ---------------- Биланс — облик ЦРМ ---------------- */

const CRM_CSS = `.zc{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:9.5px}.zc h1{font-size:16px;font-weight:700;margin:0 0 8px}.zc .zh div{margin:1.5px 0;display:block}.zc .zh b{font-weight:700}
.zc table.zt{border:1px solid #9a9a9a;font-size:8.8px;margin-top:8px}.zc table.zt th{border:1px solid #9a9a9a;background:#e9e9e9;text-align:center;font-weight:700;padding:3px 3px;vertical-align:middle;letter-spacing:0;font-size:8.6px}.zc table.zt td{border:1px solid #b5b5b5;padding:2px 4px;vertical-align:middle}
.zc td.c{text-align:center}.zc td.a{text-align:right;white-space:nowrap;font-family:Arial,Helvetica,sans-serif}.zc .ft{margin-top:14px;font-size:9.5px}.zc .ft p{margin:3px 0}`;
const nf = (v: number | undefined) => (+(v ?? 0) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CrmForm({ rep, rules, cur, prev, firm, year, sig }: {
  rep: 'bs' | 'bu'; rules: readonly ZsRule[]; cur: Record<string, number>; prev: Record<string, number>; firm: Firm; year: number; sig: Signers;
}) {
  const isB = rep === 'bs';
  const nm = (x: ZsRule) => {
    let n = withFormula({ ...x, n: String(x.n || '').trim() });
    if (isB && x.aop === '001') n = 'АКТИВА: ' + n;
    if (isB && x.aop === '065') n = 'ПАСИВА: ' + n;
    return n.replace(/^([А-ШIVX]+\.)\s+/, '$1');
  };
  return (
    <div className="zc">
      <Css css={CRM_CSS} />
      <h1>{isB ? 'Биланс на состојба' : 'Биланс на успех'}</h1>
      <div className="zh">
        <div><b>ЕМБС:</b> {firm.embs}</div><div><b>Целосно име:</b> {firm.name}</div><div>{firm.city}</div>
        <div><b>Вид на работа:</b> {firm.activity}</div><div><b>Тип на годишна сметка:</b> Годишна сметка</div><div><b>Тип на документ:</b> Годишна сметка</div><div><b>Година :</b> {year}</div>
      </div>
      <table className="zt">
        <thead><tr><th style={{ width: '13mm' }}>Ознака за АОП</th><th>Опис</th><th style={{ width: '24mm' }}>Нето за тековна година</th><th style={{ width: '22mm' }}>Бруто за тековна година</th><th style={{ width: '22mm' }}>Исправка на вредноста за тековна година</th><th style={{ width: '24mm' }}>Претходна година</th></tr></thead>
        <tbody>
          {rules.filter((x) => x.r === rep).map((x) => {
            const pv = prev[rep + x.aop];
            return <tr key={x.aop}><td className="c">{+x.aop || x.aop}</td><td>{nm(x)}</td><td className="a">{nf(Math.round(cur[rep + x.aop] || 0))}</td><td className="a" /><td className="a" /><td className="a">{Math.abs(+(pv ?? 0)) > 0.004 ? nf(Math.round(pv!)) : ''}</td></tr>;
          })}
        </tbody>
      </table>
      <div className="ft"><p><b>Потпишано од:</b> {sig.rep}{sig.office ? ' – ' + sig.office : ''}</p><p>Изјавувам, под морална, материјална и кривична одговорност, дека податоците во годишната сметка се точни и вистинити.</p></div>
    </div>
  );
}

/* ---------------- УЈП ДБ / ДБ-ВП ---------------- */

const UJP_CSS = `.ujp{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:9px}.ujp .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:4px}.ujp .code{font-size:20px;font-weight:700;border:2px solid #000;padding:2px 10px;white-space:nowrap}
.ujp .ttl{text-align:center;flex:1}.ujp .ttl b{font-size:15px;letter-spacing:.35em;display:block}.ujp .ttl span{font-size:11px}.ujp .org{font-size:8.5px;line-height:1.3}
.ujp table.id{border:1px solid #000;margin:6px 0;font-size:9px}.ujp table.id td{border:1px solid #000;padding:3px 5px;vertical-align:top}.ujp table.id td.l{background:#eee;font-size:8px;width:32%}
.ujp .st{border:1px solid #000;padding:3px 6px;margin:4px 0;font-size:8.5px}.ujp .st span{margin-right:14px}
.ujp .sec{background:#000;color:#fff;font-weight:700;padding:3px 6px;margin-top:6px;font-size:9.5px}
.ujp table.dt{border:1px solid #000;font-size:8.6px;margin:0}.ujp table.dt th{border:1px solid #000;background:#ddd;text-align:center;font-weight:700;padding:2px}.ujp table.dt td{border:1px solid #000;padding:2px 4px;vertical-align:middle}
.ujp tr.h td{background:#eee;font-weight:700}.ujp td.aop{text-align:center;width:11mm;font-weight:700}.ujp td.amt{text-align:right;width:30mm;white-space:nowrap;font-family:"Courier New",monospace;font-size:9.5px}.ujp td.rn{width:9mm;text-align:center}
.ujp table.sg{border:1px solid #000;margin-top:8px;font-size:8.5px}.ujp table.sg td,.ujp table.sg th{border:1px solid #000;padding:3px 5px;height:16px}.ujp table.sg th{background:#eee;text-align:left}.ujp .small{font-size:8px;font-style:italic}`;

function SignTable({ sig }: { sig: Signers }) {
  return (
    <table className="sg"><tbody>
      <tr><th colSpan={5}>ПОДАТОЦИ ЗА СОСТАВУВАЧОТ</th></tr>
      <tr><td style={{ width: '30%' }}>Назив / Име и презиме<br /><b>{sig.office || sig.rep}</b></td><td>ЕДБ / ЕМБГ<br />{sig.officeEdb}</td><td>Датум на пополнување<br />{dmy(today())}</td><td>Својство<br />{sig.office ? 'Сметководител' : ''}</td><td style={{ width: '22%' }}>Потпис</td></tr>
      <tr><th colSpan={5}>ПОДАТОЦИ ЗА ПОТПИСНИКОТ</th></tr>
      <tr><td>Име и презиме<br /><b>{sig.signer}</b></td><td>ЕМБГ<br /></td><td>Датум на пополнување<br />{dmy(today())}</td><td>Својство<br />{sig.signerRole}</td><td>Потпис</td></tr>
    </tbody></table>
  );
}

function UjpHead({ firm, year, code, sub }: { firm: Firm; year: number; code: string; sub: string }) {
  return (
    <>
      <div className="top"><div className="org">РЕПУБЛИКА СЕВЕРНА МАКЕДОНИЈА<br />УПРАВА ЗА ЈАВНИ ПРИХОДИ</div><div className="ttl"><b>ДАНОЧЕН БИЛАНС</b><span>{sub}</span></div><div className="code">{code}</div></div>
      <table className="id"><tbody>
        <tr><td className="l">Единствен даночен број</td><td colSpan={3}><b>{dbEdb(firm.edb)}</b></td></tr>
        <tr><td className="l">Скратен назив и адреса на вистинско седиште за контакт</td><td colSpan={3}>{S(firm).short || firm.name}<br />{[firm.address, firm.city].filter(Boolean).join(', ')}</td></tr>
        <tr><td className="l">Телефон / е-пошта</td><td colSpan={3}>{firm.phone}{firm.email ? ' / ' + firm.email : ''}</td></tr>
        <tr><td className="l">Даночен период</td><td colSpan={3}>од 01.01.{year} до 31.12.{year}</td></tr>
        <tr><td className="l">Исправка / Број</td><td colSpan={3}>☐ &nbsp; ________</td></tr>
      </tbody></table>
    </>
  );
}

export function DbForm({ D, firm, year, sig }: { D: DbResult; firm: Firm; year: number; sig: Signers }) {
  const V = D.V;
  return (
    <div className="ujp">
      <Css css={UJP_CSS} />
      <UjpHead firm={firm} year={year} code="ДБ" sub="за оданочување на добивка" />
      <div className="st"><b>Посебен даночен статус:</b> &nbsp; <span>☐ Заштитни друштва</span><span>☐ ТИРЗ</span><span>☐ Казнено поправни домови</span></div>
      <div className="sec">УТВРДУВАЊЕ НА ДАНОК НА ДОБИВКА „без дени“</div>
      <table className="dt">
        <thead><tr><th style={{ width: '9mm' }} /><th>Опис</th><th style={{ width: '11mm' }}>АОП</th><th style={{ width: '30mm' }}>Износ</th></tr></thead>
        <tbody>
          {DB_F.map((r) => r[0] === 'h'
            ? <tr className="h" key={'h' + r[1]}><td className="rn">{r[1]}</td><td colSpan={3}>{r[2]}</td></tr>
            : <tr key={r[0]} className={r[3] === 'auto' ? 'h' : ''}><td className="rn" /><td>{r[2]}</td><td className="aop">{r[0]}</td>
                <td className="amt">{r[0] === '59' && (V['59'] ?? 0) < 0 ? `(${fi(-(V['59'] ?? 0))})` : amt(V[r[0]])}</td></tr>)}
        </tbody>
      </table>
      <SignTable sig={sig} />
    </div>
  );
}

export function VpForm({ D, firm, year, sig }: { D: VpResult; firm: Firm; year: number; sig: Signers }) {
  const row = (n: number, t: string, a: string, v: string) => <tr key={a}><td className="rn">{n}</td><td>{t}</td><td className="aop">{a}</td><td className="amt">{v}</td></tr>;
  return (
    <div className="ujp" style={{ fontSize: '9.5px' }}>
      <Css css={UJP_CSS} />
      <UjpHead firm={firm} year={year} code="ДБ-ВП" sub="на вкупен приход" />
      <div className="sec" style={{ textAlign: 'center' }}>УТВРДУВАЊЕ НА ГОДИШЕН ДАНОК НА ВКУПЕН ПРИХОД</div>
      <table className="dt"><thead><tr><th style={{ width: '9mm' }}>Ред. бр.</th><th>Опис</th><th style={{ width: '13mm' }}>АОП</th><th style={{ width: '38mm' }}>Износ</th></tr></thead><tbody>
        {row(1, 'Вкупен приход утврден во Билансот на успех', '01', amt(D.inc))}
        {row(2, 'Пропишана стапка (стапка од член 34 на ЗДД)', '05', D.rate + '%')}
        {row(3, 'Годишен данок на вкупен приход', '06', amt(D.tax) || '0')}
        {row(4, 'Износ на платени аконтации на данокот на добивка', '07', amt(D.ak) || '0')}
      </tbody></table>
      <div className="sec" style={{ background: '#444', textAlign: 'center' }}>ПОДАТОЦИ ЗА ДЕЈНОСТА</div>
      <table className="id" style={{ marginTop: 0 }}><tbody>
        <tr><td className="l">Опис на дејност</td><td colSpan={3}>{D.desc}</td></tr>
        <tr><td className="l">Шифра НАЦЕ</td><td style={{ width: '22%' }}>{D.nace}</td><td className="l" style={{ width: '14%' }}>Назив НАЦЕ</td><td>{D.naceN}</td></tr>
        <tr><td className="l">Друштво за вработување на инвалидизирани лица</td><td>{D.inv}</td><td className="l">Правна форма</td><td>{D.form}</td></tr>
        <tr><td className="l">Година определена за ГДВП</td><td colSpan={3}>{D.gdvp}</td></tr>
      </tbody></table>
      <SignTable sig={sig} />
      <div className="small">* Пополнува Управа за јавни приходи</div>
    </div>
  );
}

/* ---------------- Белешки ---------------- */

export function BelPrint({ firm, year, cur, prev, notes, prevNotes, sig }: {
  firm: Firm; year: number; cur: Record<string, number>; prev: Record<string, number>; notes?: Record<string, string> | null; prevNotes?: Record<string, string> | null; sig: Signers;
}) {
  const N = belResolve(belFirm(firm), year, cur, prev, notes, prevNotes);
  const fa = (v: number) => (v ? fi(v) : '-');
  return (
    <div>
      <div className="ph"><div><div className="pt">ОБЈАСНУВАЧКИ БЕЛЕШКИ</div><div className="ps">кон финансиските извештаи за {year} година</div></div><div className="pm">{firm.name}<br />ЕМБС {firm.embs} · ЕДБ {dbEdb(firm.edb)}</div></div>
      {N.map((n) => (
        <div key={n.id} style={{ margin: '0 0 10px' }}>
          <div style={{ fontWeight: 700, margin: '0 0 3px' }}>{n.no}. {n.title}</div>
          {n.rows.length > 0 && (
            <table style={{ maxWidth: 640 }}><thead><tr><th>Позиција</th><th style={{ width: 44 }}>АОП</th><th className="n" style={{ width: 110 }}>{year}</th><th className="n" style={{ width: 110 }}>{year - 1}</th></tr></thead>
              <tbody>{n.rows.map((r) => <tr key={r.aop}><td>{r.label}</td><td>{r.aop}</td><td className="n">{fa(r.cur)}</td><td className="n">{fa(r.prev)}</td></tr>)}</tbody></table>
          )}
          {n.text && <p style={{ margin: '3px 0 0', textAlign: 'justify' }}>{n.text}</p>}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <div>Составил: {sig.rep}</div><div>{sig.signerRole}: {sig.signer}</div>
      </div>
    </div>
  );
}
