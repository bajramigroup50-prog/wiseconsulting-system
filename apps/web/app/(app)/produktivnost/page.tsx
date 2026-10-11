/**
 * 📊 Продуктивност на вработените (Систем) — how much work each colleague did in a period: movements by kind of work
 * (Креирано / Изменето / Избришано), firms, active days, estimated active time, movements per active hour, volumes
 * (journal lines, bank lines, invoice totals), per firm and per day, with a drill-down into the raw activity log.
 * Only for the office owner (`lib/office-owner.ts`); sign-ins, settings and downloads are not counted.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PERIOD_PRESETS, BURST_GAP_MIN } from '@wise/core/office/productivity';
import { ActionForm, Submit } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { dmy } from '@/lib/fmt';
import { OWNER_ONLY_MSG, officeOwner } from '@/lib/office-owner';
import { transferOwner } from './actions';
import { loadProductivity, ownerGate, prodFilter, prodQs } from './data';
import { ReportView } from './report-view';

const T = '📊 Продуктивност на вработените';

export default async function ProduktivnostPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { u, ok } = await ownerGate();
  if (u.role === 'klient' || u.role === 'teren') notFound();
  if (!ok) return <><Hd t={T} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  const f = prodFilter(await searchParams);
  const D = await loadProductivity(f);
  const owner = await officeOwner();
  const qs = prodQs(f);
  const keep = (o: Record<string, string>) => { const q = new URLSearchParams(o); if (f.user) q.set('u', f.user); if (f.firm) q.set('f', f.firm); return `/produktivnost?${q}`; };
  const admins = D.userList.filter((x) => x.role === 'admin' && x.active && x.id !== u.id);
  return (
    <>
      <Hd t={T} sub={`${dmy(f.from)} – ${dmy(f.to)}`} exp={false}>
        <a className="btn" href={`/print/produktivnost?${qs}`} target="_blank" rel="noopener">⬇ PDF</a>
        <a className="btn" href={`/produktivnost/xlsx?${qs}`}>⬇ Excel</a>
      </Hd>
      <form className="card" method="get">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {PERIOD_PRESETS.map(([k, l]) => <Link key={k} className={`btn sm${f.preset === k ? ' pri' : ''}`} href={keep({ p: k })}>{l}</Link>)}
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f" style={{ margin: 0 }}>Од<input type="date" name="od" defaultValue={f.from} /></label>
          <label className="f" style={{ margin: 0 }}>До<input type="date" name="do" defaultValue={f.to} /></label>
          <label className="f" style={{ margin: 0 }}>Корисник<select name="u" defaultValue={f.user} style={{ width: 'auto' }}>
            <option value="">Сите корисници</option>
            {D.userList.map((x) => <option key={x.id} value={x.id}>{x.name}{x.active ? '' : ' (неактивен)'}</option>)}
            <option value="-">⚙ Автоматски (систем)</option>
          </select></label>
          <label className="f" style={{ margin: 0 }}>Фирма<select name="f" defaultValue={f.firm} style={{ width: 'auto', maxWidth: 280 }}>
            <option value="">Сите фирми</option>
            {D.firmList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
          <button className="btn pri">Прикажи</button>
        </div>
        <p className="note" style={{ margin: '8px 0 0' }}>
          <b>Движење</b> = една зачувана работа (фактура, налог, ставка од извод, плата…), од Дневникот на активности. Не се бројат најави / одјави,
          поставки и преземања; налозите што се книжат автоматски од документ не се бројат двапати (се бројат само нивните ставки).
          <b> Активно време</b> = збир на периодите на непрекината работа (пауза пократка од {BURST_GAP_MIN} мин), секој период најмалку 1 минута.
        </p>
      </form>
      <ReportView D={D} f={f} />
      <ActionForm action={transferOwner} className="card" reset={false} style={{ marginTop: 14 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div>🔒 Овој извештај го гледа само сопственикот на канцеларијата: <b>{owner?.name ?? u.name}</b>.</div>
          {admins.length > 0 && <>
            <label className="f" style={{ margin: 0 }}>Пренеси на<select name="to" defaultValue="" style={{ width: 'auto' }}>
              <option value="" disabled>— администратор —</option>
              {admins.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
            <label className="row" style={{ gap: 4, margin: 0 }}><input type="checkbox" name="ok" required /> Потврдувам – потоа јас повеќе не го гледам извештајот</label>
            <Submit className="btn">Пренеси сопственост</Submit>
          </>}
        </div>
      </ActionForm>
    </>
  );
}
