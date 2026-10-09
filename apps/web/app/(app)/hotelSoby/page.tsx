/** Legacy `VIEWS.hotelSoby` 9602 — Хотел – соби и цени + поставки (tourist tax, age limits, VAT, kontos, payer). */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { firmHotelConfig, hotelRooms } from '@wise/db';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { cleanRoomAction, saveHotelConfigAction, saveRoomAction } from '../hotel/actions';

export default async function HotelSoby({ searchParams }: { searchParams: Promise<{ ed?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('hotelSoby', 'Хотел – соби и цени');
  if (g.blocked) return g.blocked;
  const R = await db().select().from(hotelRooms).where(eq(hotelRooms.firmId, g.firm.id)).orderBy(asc(hotelRooms.no));
  const H = firmHotelConfig(g.firm);
  const E = sp.ed === 'new' ? { id: '', no: '', kind: '', beds: 2, floor: '', price: '', active: true } : R.find((r) => r.id === sp.ed);
  return (
    <>
      <Hd t="Хотел – соби и цени" sub={`${R.length} соби`}>
        <Link className="btn" href="/hotel">🏨 Рецепција</Link>
        {g.write && <Link className="btn pri" href="/hotelSoby?ed=new">+ Соба</Link>}
      </Hd>
      {E && g.write && (
        <BankForm action={saveRoomAction} className="card">
          <input type="hidden" name="id" value={E.id} />
          <div className="form">
            <label className="f">Број на соба<input name="no" defaultValue={E.no} /></label>
            <label className="f">Тип<input name="kind" defaultValue={E.kind ?? ''} list="hr_kl" placeholder="Двокреветна" /></label>
            <datalist id="hr_kl">{['Еднокреветна', 'Двокреветна', 'Трокреветна', 'Апартман', 'Студио', 'Семејна'].map((x) => <option key={x} value={x} />)}</datalist>
            <label className="f">Легла<input name="beds" type="number" defaultValue={E.beds} /></label>
            <label className="f">Кат<input name="floor" defaultValue={E.floor ?? ''} /></label>
            <label className="f">Цена по ноќ со ДДВ<input name="price" type="number" step="any" defaultValue={Number(E.price) || ''} /></label>
          </div>
          <label className="chk"><input type="checkbox" name="active" defaultChecked={E.active} /> Активна (во продажба)</label>
          <div className="row" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} /><Link className="btn" href="/hotelSoby">Откажи</Link><button className="btn pri">Зачувај</button></div>
        </BankForm>
      )}
      <div className="tw"><table><thead><tr><th>Соба</th><th>Тип</th><th className="n">Легла</th><th>Кат</th><th className="n">Цена/ноќ</th><th>Статус</th><th /></tr></thead>
        <tbody>{R.map((r) => (
          <tr key={r.id}><td><b>{r.no}</b></td><td>{r.kind}</td><td className="n">{r.beds}</td><td>{r.floor}</td><td className="n">{fmt(r.price)}</td>
            <td>{!r.active ? <span className="pill">неактивна</span> : r.hk === 'dirty' ? <span className="pill warn">за чистење</span> : <span className="pill good">подготвена</span>}</td>
            <td>{g.write && <>{r.hk === 'dirty' && <RowAction action={cleanRoomAction.bind(null, r.id)} label="🧹 Исчистена" />} <Link className="btn sm" href={`/hotelSoby?ed=${r.id}`}>Измени</Link></>}</td></tr>
        ))}{!R.length && <tr><td colSpan={7} className="note">Нема соби.</td></tr>}</tbody></table></div>
      <BankForm action={saveHotelConfigAction} className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Поставки</h2>
        <div className="form">
          <label className="f">Такса за привремен престој (ден. по лице/ноќ)<input name="tax" type="number" step="any" defaultValue={H.tax} /></label>
          <label className="f">Деца ослободени до (години, без)<input name="freeAge" type="number" defaultValue={H.freeAge} placeholder="празно = нема" /></label>
          <label className="f">Деца 50% до (години, без)<input name="halfAge" type="number" defaultValue={H.halfAge} placeholder="празно = нема" /></label>
          <label className="f">ДДВ за сместување %<select name="rate" defaultValue={String(H.rate)}><option value="5">5%</option><option value="10">10%</option><option value="18">18%</option></select></label>
          <label className="f">Конто приход од ноќевања<input name="revK" defaultValue={H.revK} placeholder="од шемата (услуги)" /></label>
          <label className="f">Конто обврска за такса<input name="taxK" defaultValue={H.taxK} /></label>
          <label className="f">Фактура за гости без фирма<select name="payer" defaultValue={H.payer}><option value="">на заеднички комитент „Гости – физички лица“</option><option value="guest">на посебен комитент за секој гостин</option></select></label>
        </div>
        <p className="note">ДДВ: ноќевањето (и со појадок, полупансион, полн пансион) е со повластена стапка 5%; посебно наплатената храна и безалкохолни пијалаци 10%, алкохолот 18%. Таксата за привремен престој ја утврдува општината. Таксата не е приход: се книжи на обврска ({H.taxK}) и се уплатува на општината.</p>
        {g.write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај поставки</button></div>}
      </BankForm>
    </>
  );
}
