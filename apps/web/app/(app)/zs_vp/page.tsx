/**
 * Legacy `VIEWS.zs_vp` 17138 (+ `vpData` 17105, ACT `vpSave`/`vpPrev`/`vpPdf` 17152–17154) — ДБ-ВП, annual tax on
 * total income (1 % when total income is above 3 and up to 6 million denars).
 * New: "the firm pays ДБ-ВП this year" switch — the year close then books the ДБ-ВП tax instead of the ДБ tax.
 */
import Link from 'next/link';
import { fmt } from '@/lib/fmt';
import { phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { ActionForm } from '@/components/yearend/action-form';
import { NotClosedNote, ZsHead } from '@/components/yearend/ph-bar';
import { saveVp } from '../zsProc/actions';

export default async function ZsVpPage() {
  const c = await yePage('zs_vp');
  if (!c) return <NoFirm t="ДБ-ВП" />;
  const { L, year } = c;
  const D = L.Y.vp;
  const on = !!(L.statement?.vpAdj as { on?: boolean } | undefined)?.on;
  const inp = (k: string, v: unknown, n = false) => (
    <input name={'vp' + k} type={n ? 'number' : undefined} step={n ? 1 : undefined} defaultValue={v == null ? '' : String(v)}
      style={{ display: 'block', marginLeft: 'auto', width: n ? 170 : '100%', textAlign: n ? 'right' : undefined }} />
  );
  return (
    <>
      <ZsHead id="zs_vp" t="Годишен данок на вкупен приход (ДБ-ВП)" year={year} ent={L.ent} done={phaseDone(L)}>
        <Link className="btn pri" href="/pecati/vp" target="_blank">🖨 Образец ДБ-ВП (печати / PDF)</Link>
      </ZsHead>
      <NotClosedNote closed={L.Y.closed} year={year} />
      <div className="callout">
        Образец <b>ДБ-ВП</b> на УЈП (без дени). АОП 01 е од Билансот на успех (АОП 201 + 223), АОП 07 од конто 2330 – може да се изменат.{' '}
        {D.elig ? 'Приходот е меѓу 3 и 6 милиони денари – се плаќа 1%.' : D.inc <= 3_000_000 ? 'Приход до 3 мил. ден. – данокот е 0 (ослободено).' : <b>Приход над 6 мил. ден. – не може ДБ-ВП, се поднесува ДБ.</b>} Рок: 15.02.{year + 1}.
      </div>
      <ActionForm action={saveVp} submit="Зачувај" className="">
        <label className="chk" style={{ margin: '0 0 8px' }}><input type="checkbox" name="vpon" defaultChecked={on} /> Фирмата е обврзник на ДБ-ВП за {year} (затворањето го книжи данокот од АОП 06 наместо од ДБ)</label>
        <div className="tw"><table className="dense">
          <thead><tr><th style={{ width: 40 }}>Ред.</th><th>Опис</th><th style={{ width: 50 }}>АОП</th><th className="n" style={{ width: 190 }}>Износ</th></tr></thead>
          <tbody>
            <tr><td>1</td><td>Вкупен приход утврден во Билансот на успех <span className="mini">(пресметано {fmt(D.incAuto)})</span></td><td>01</td><td className="n">{inp('01', D.A['01'], true)}<div className="mini">{fmt(D.inc)}</div></td></tr>
            <tr className="tot"><td>2</td><td>Пропишана стапка (стапка од член 34 на ЗДД)</td><td>05</td><td className="n">{D.rate}%</td></tr>
            <tr className="tot"><td>3</td><td>Годишен данок на вкупен приход</td><td>06</td><td className="n"><b>{fmt(D.tax)}</b></td></tr>
            <tr><td>4</td><td>Износ на платени аконтации на данокот на добивка <span className="mini">(од 2330: {fmt(D.akAuto)})</span></td><td>07</td><td className="n">{inp('07', D.A['07'], true)}<div className="mini">{fmt(D.ak)}</div></td></tr>
            <tr className="tot"><td /><td>{D.diff >= 0 ? 'За доплата' : 'Повеќе платено'} (06 − 07)</td><td /><td className="n"><b>{fmt(Math.abs(D.diff))}</b></td></tr>
          </tbody>
        </table></div>
        <div className="card"><h2>Податоци за дејноста</h2>
          <div className="form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            <label className="f">Опис на дејност{inp('desc', D.desc)}</label>
            <label className="f">Шифра НАЦЕ{inp('nace', D.nace)}</label>
            <label className="f">Назив НАЦЕ{inp('naceN', D.naceN)}</label>
            <label className="f">Друштво за вработување на инвалидизирани лица
              <select name="vpinv" defaultValue={D.inv}><option>НЕ</option><option>ДА</option></select></label>
            <label className="f">Правна форма{inp('form', D.form)}</label>
            <label className="f">Година определена за ГДВП{inp('gdvp', D.gdvp)}</label>
          </div>
        </div>
      </ActionForm>
    </>
  );
}
