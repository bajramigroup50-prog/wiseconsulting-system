/**
 * Official ДДВ-04 layout (legacy `ddvFormHTML` 5919, CSS verbatim). Used on the ДДВ-04 screen
 * ("Образец") and on the print view `/print/ddv04`.
 *
 * Legacy `FORM_BG` holds background images only for the ДДВ-01 registration attachments
 * (`f_ujp_ddv_dobr`, `f_ujp_ddv_prom`) and the УЈП code request — there is no ДДВ-04 image; legacy
 * draws this form in HTML/CSS, and so does this component.
 */
import { DDV04_FORM_ROWS1, DDV04_FORM_ROWS2, perRange, periodDue } from '@wise/core';
import type { Firm } from '@wise/db';

/** Whole denars, mk grouping (legacy `fi`). */
export const fi = (n: number | string | null | undefined): string => {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};
const sl = (d: string) => (d ? d.split('-').reverse().join('/') : '');

const CSS = `
.ujp{--t:#3f9c8c;font-family:Arial,"IBM Plex Sans",sans-serif;color:#222;font-size:10px}
.ujp .top{display:grid;grid-template-columns:1fr 3fr 1fr;align-items:end;border-bottom:2px solid #555;padding-bottom:6px;margin-bottom:10px}
.ujp .org{font-size:8.5px;color:#a0224e;line-height:1.25}
.ujp .ttl{text-align:center}.ujp .ttl b{display:block;font-size:19px;letter-spacing:.14em}.ujp .ttl span{font-size:14px;font-weight:700;letter-spacing:.03em}
.ujp .pr{text-align:right}.ujp .pr small{font-weight:700;font-size:11px;letter-spacing:.06em}.ujp .pr div{background:var(--t);color:#111;font-weight:700;font-size:17px;padding:14px 10px;text-align:center;margin-top:3px}
.ujp .hdr{display:grid;grid-template-columns:1.25fr 1fr;gap:18px}
.ujp .fr{display:grid;grid-template-columns:30mm 1fr;gap:6px;align-items:start;margin-bottom:7px}
.ujp .fr>span{font-size:9px;color:#333}.ujp .in{border:1.3px solid var(--t);min-height:18px;padding:3px 6px;font-size:10.5px}
.ujp .rcv{background:var(--t);padding:6px;display:grid;grid-template-columns:18mm 1fr;gap:6px;align-items:center;margin-bottom:8px}
.ujp .rcv span{font-size:9px}.ujp .rcv .in{background:#fff;min-height:44px;border:0}
.ujp .pp{display:grid;grid-template-columns:20mm 1fr 8mm 1fr;gap:5px;align-items:center;margin-bottom:6px}.ujp .pp span{font-size:9px;text-align:right}
.ujp h3{font-size:12px;margin:14px 0 4px;letter-spacing:.02em}
.ujp table{width:100%;border-collapse:separate!important;border-spacing:0 3px;border:1.3px solid var(--t);padding:2px 4px}
.ujp td{border:0;padding:3px 5px;vertical-align:middle}
.ujp th,.ujp thead th{background:none!important;color:#111!important;font-size:10px;padding:5px;text-align:center;border:0!important;text-transform:none;letter-spacing:0;position:static}
.ujp tbody tr td,.ujp tbody tr:nth-child(even) td,.ujp tbody tr:hover td{background:none}
.ujp td:not(.b){border-bottom:0!important}.ujp td.b{border-bottom:1.3px solid var(--t)!important}
.ujp td.l{font-size:9px;width:48%;line-height:1.2}.ujp td.k{width:5%;text-align:right;color:#444;font-size:9.5px}
.ujp td.b{width:21%;border:1.3px solid var(--t);text-align:right;font-family:Arial,sans-serif;font-size:11px;height:20px}
.ujp tr.t td.l{font-weight:700}.ujp tr.t td.b{font-weight:700;background:#eef7f5}
.ujp .foot{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:12px}
.ujp .chk{display:inline-block;width:10px;height:10px;border:1.2px solid var(--t);margin:0 4px -1px 10px}
`;

type FirmInfo = Pick<Firm, 'name' | 'edb' | 'address' | 'city' | 'phone' | 'email' | 'settings'>;

export function Ddv04Form({ firm, period, fields: F, amendmentNo, today }: {
  firm: FirmInfo; period: string; fields: Record<string, number>; amendmentNo?: string; today: string;
}) {
  const [od, do_] = perRange(period);
  const s = (firm.settings ?? {}) as Record<string, string | undefined>;
  const prep = [s.dc_first, s.dc_last].filter(Boolean).join(' ');
  const bx = (k: string | null | undefined) => (k
    ? <><td className="k">{k}</td><td className="b">{fi(F[k])}</td></>
    : <><td className="k" /><td /></>);
  const rows = (R: typeof DDV04_FORM_ROWS1) => R.map(([t, a, b]) => (
    <tr key={t} className={b && ['20', '29', '31'].includes(b) && !a ? 't' : undefined}>
      <td className="l">{t}</td>{bx(a)}{bx(b)}
    </tr>
  ));
  const head = <thead><tr><th /><th /><th>Даночна основа без ДДВ</th><th /><th>ДДВ</th></tr></thead>;
  const f31 = F['31'] ?? 0;
  return (
    <div className="ujp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="top">
        <div className="org">Република Северна Македонија<br />Министерство за финансии<br /><b>УПРАВА ЗА ЈАВНИ ПРИХОДИ</b></div>
        <div className="ttl"><b>ДАНОЧНА ПРИЈАВА</b><span>на данокот на додадена вредност</span></div>
        <div className="pr"><small>ПРИЛОГ</small><div>ДДВ-04</div></div>
      </div>
      <div className="hdr">
        <div>
          <div className="fr"><span>Даночен идентификациски број</span><div className="in">{firm.edb ?? ''}</div></div>
          <div className="fr"><span>Скратен назив и адреса на вистинско седиште за контакт</span><div className="in" style={{ minHeight: 40 }}>{[firm.name, firm.address, firm.city].filter(Boolean).join(' ')}</div></div>
          <div className="fr"><span>Телефон</span><div className="in">{firm.phone || s.dc_phone || ''}</div></div>
          <div className="fr"><span>е-пошта</span><div className="in">{firm.email ?? ''}</div></div>
        </div>
        <div>
          <div className="rcv"><span>Датум и време на прием</span><div className="in" /></div>
          <div style={{ textAlign: 'center', fontSize: 9, marginBottom: 3 }}>Даночен период</div>
          <div className="pp"><span>од</span><div className="in">{sl(od)}</div><span>до</span><div className="in">{sl(do_)}</div></div>
          <div className="pp" style={{ gridTemplateColumns: '20mm 1fr' }}><span>Рок за поднесување</span><div className="in">{sl(periodDue(period))}</div></div>
          <div className="pp" style={{ gridTemplateColumns: '20mm 1fr' }}><span>Исправка на ДДВ-04</span><div className="in">Број: {amendmentNo ?? ''}</div></div>
        </div>
      </div>
      <h3>ПРОМЕТ НА ДОБРА И УСЛУГИ</h3>
      <table>{head}<tbody>{rows(DDV04_FORM_ROWS1)}</tbody></table>
      <h3>ПРЕТХОДЕН ДАНОК</h3>
      <table>{head}<tbody>{rows(DDV04_FORM_ROWS2)}</tbody></table>
      <div className="foot">
        <div className="in" style={{ padding: 8 }}>
          {f31 >= 0
            ? <>Даночен долг за уплата: <b>{fi(f31)} ден.</b></>
            : <>Даночно побарување: <b>{fi(-f31)} ден.</b><br /><span className="chk" />Барам поврат <span className="chk" />Барам пребивање</>}
        </div>
        <div className="in" style={{ padding: 8, minHeight: 44 }}>
          Составувач: {prep || '________________'}
          {s.ro_first && <><br />Одговорно лице: {s.ro_first} {s.ro_last ?? ''}</>}
          <br />Датум: {sl(today)}
        </div>
      </div>
    </div>
  );
}
