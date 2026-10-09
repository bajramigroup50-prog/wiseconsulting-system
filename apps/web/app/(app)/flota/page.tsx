/** Legacy `VIEWS.flota` 9834 — Rent-a-car – флота и цени + поставки (VAT, kontos, fuel, grace, season, terms). */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { firmRentConfig, fleetVehicles } from '@wise/db';
import { db } from '@/lib/db';
import { industryPage } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { FleetSection } from '@/components/fleet';
import { Hd } from '@/components/hd';
import { saveRentConfigAction } from '../rent/actions';

export default async function Flota({ searchParams }: { searchParams: Promise<{ ed?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('flota', 'Rent-a-car – флота и цени');
  if (g.blocked) return g.blocked;
  const V = await db().select().from(fleetVehicles).where(eq(fleetVehicles.firmId, g.firm.id)).orderBy(asc(fleetVehicles.plate));
  const C = firmRentConfig(g.firm);
  return (
    <>
      <Hd t="Rent-a-car – флота и цени" sub={`${V.filter((v) => v.rent).length} возила за изнајмување`}><Link className="btn" href="/rent">🚗 Резервации</Link></Hd>
      <FleetSection V={V} ed={sp.ed} base="/flota" write={g.write} rent />
      <BankForm action={saveRentConfigAction} className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Поставки</h2>
        <div className="form">
          <label className="f">ДДВ %<select name="rate" defaultValue={String(C.rate)}><option value="18">18%</option><option value="5">5%</option><option value="10">10%</option></select></label>
          <label className="f">Конто приход<input name="revK" defaultValue={C.revK} placeholder="од шемата (услуги)" /></label>
          <label className="f">Конто кауции<input name="depK" defaultValue={C.depK} /></label>
          <label className="f">Гориво – цена по 1/8 резервоар<input name="fuel8" type="number" step="any" defaultValue={C.fuel8} /></label>
          <label className="f">Толеранција за доцнење (часови)<input name="grace" type="number" step="any" defaultValue={C.grace} /></label>
          <label className="f">Минимална возраст на возачот<input name="minAge" type="number" defaultValue={C.minAge} /></label>
          <label className="f">Минимум години возачка<input name="minLic" type="number" defaultValue={C.minLic} /></label>
          <label className="f">Сезонски додаток %<input name="sPct" type="number" step="any" defaultValue={C.sPct} /></label>
          <label className="f">Сезона од (ММ-ДД)<input name="sFrom" defaultValue={C.sFrom} /></label>
          <label className="f">Сезона до (ММ-ДД)<input name="sTo" defaultValue={C.sTo} /></label>
          <label className="f wide">Услови во договорот<textarea name="terms" rows={6} defaultValue={C.terms} /></label>
        </div>
        <p className="note">Денови = започнати 24 часа од преземањето (со толеранција за доцнење). Кауцијата не е приход: се прима со уплатница на конто {C.depK} и се враќа со исплатница или се пребива со фактурата.</p>
        {g.write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај поставки</button></div>}
      </BankForm>
    </>
  );
}
