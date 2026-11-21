/**
 * „🥫 Кујна – залиха“ tab of /obroci: the kitchen warehouse and the normative per meal kind (items per portion), the
 * button that issues the consumption (portions × normative) as one издатница per day, and the приемници of donations
 * in kind (value, lot, expiry) linked to the donation contracts. Plus `KitchenReport` for the 📊 reports tab:
 * received / used / left per item and the real cost per portion from stock.
 */
import Link from 'next/link';
import { and, asc, eq } from 'drizzle-orm';
import { MEALS, mealKindsOf } from '@wise/core/meals';
import { kitchenReport, mealConsumption, portionsByDay } from '@wise/core/npo';
import { donKonto, donChart } from '@wise/core/donations';
import {
  donations, kitchenMoves, listBeneficiaries, listDonationReceipts, loadStockContext, mealIssues, mealLogsBetween, mealStockSettings, partners, type Firm,
} from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { locOptions } from '@/lib/stock';
import { BankForm } from '@/components/bank-form';
import { RowAction } from '@/components/row-action';
import { deleteDonReceiptAction, donReceiptAction, issueMealsAction, mealNormAction } from './actions';
import { isNpoFirm } from '../donacii/data';

const q4 = (x: number) => String(Math.round(x * 1e4) / 1e4).replace('.', ',');

export async function KitchenTab({ firm, write, from, to, pr, nd }: { firm: Firm; write: boolean; from: string; to: string; pr?: string; nd?: string }) {
  const L = await loadStockContext(db(), firm.id);
  const S = mealStockSettings(firm);
  const locs = locOptions(L);
  const its = (L.ctx.items ?? []).filter((i) => i.type && i.type !== 'service').sort((a, b) => String(a.name).localeCompare(String(b.name), 'mk'));
  const nm = (id: string) => L.items.get(id)?.name ?? '?';
  const unit = (id: string) => L.items.get(id)?.unit ?? '';
  const [B, Lg, I, R, D] = await Promise.all([
    listBeneficiaries(db(), firm.id, true), mealLogsBetween(db(), firm.id, from, to), mealIssues(db(), firm.id, from, to),
    listDonationReceipts(db(), firm.id), db().select({ id: donations.id, number: donations.number, date: donations.date, inKind: donations.inKind, pn: partners.name, konto: donations.konto })
      .from(donations).leftJoin(partners, eq(partners.id, donations.partnerId)).where(and(eq(donations.firmId, firm.id), eq(donations.role, 'received'))).orderBy(asc(donations.date)),
  ]);
  const kinds = mealKindsOf(firm.settings);
  const KM = MEALS.filter(([k]) => kinds.includes(k));
  const P = portionsByDay(B, Lg.filter((x) => kinds.includes(x.meal as never)));
  const days = [...new Set([...P.keys(), ...I.keys()])].sort();
  const chart = donChart(isNpoFirm(firm), ((firm.settings ?? {}) as { accounts?: Record<string, unknown> }).accounts);
  const ItemSel = ({ name, v }: { name: string; v?: string }) => (
    <select name={name} defaultValue={v ?? ''} style={{ maxWidth: 260 }}><option value="">—</option>{its.map((i) => <option key={i.id} value={i.id}>{i.name}{i.unit ? ` (${i.unit})` : ''}</option>)}</select>
  );

  // ---- donation receipt editor
  if (pr && write) {
    const E = pr !== 'new' ? R.find((r) => r.id === pr) : undefined;
    const don = D.find((d) => d.id === (E?.donationId ?? nd));
    const rows = [...(E?.lines ?? []), ...Array.from({ length: Math.max(4, 12 - (E?.lines.length ?? 0)) }, () => null)];
    return (
      <div className="card">
        <h2 style={{ margin: '0 0 6px' }}>{E ? `Приемница на донација ${E.number}` : '+ Приемница на донација во добра'}</h2>
        <BankForm action={donReceiptAction}>
          <input type="hidden" name="id" value={E?.id ?? ''} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="f">Договор за донација<select name="donationId" defaultValue={E?.donationId ?? nd ?? ''}><option value="">— без договор —</option>{D.map((d) => <option key={d.id} value={d.id}>{d.number} · {d.pn ?? ''} · {dmy(d.date)}{d.inKind ? ' · во добра' : ''}</option>)}</select></label>
            <label className="f">Датум<input type="date" name="date" required defaultValue={E?.date ?? to} /></label>
            <label className="f">Магацин<select name="wh" defaultValue={E?.locationId ?? S.wh ?? 'main'}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label className="f" title="Д залиха / П приход од донации во добра (НПО план 731, инаку 7672); празно = без книжење">Конто (приход)<input name="account" defaultValue={E?.account ?? (don?.konto || donKonto('donation', 'received', chart, true))} style={{ width: 90 }} /></label>
            <label className="f" style={{ minWidth: 260 }}>Забелешка (фактура за донација бр., записник…)<input name="note" defaultValue={E?.note ?? ''} /></label>
          </div>
          <table className="dense" style={{ marginTop: 8 }}>
            <thead><tr><th>Артикл</th><th className="n">Количина</th><th className="n">Цена (вредност по ед.)</th><th>Лот / серија</th><th>Рок на траење</th></tr></thead>
            <tbody>{rows.map((l, i) => (
              <tr key={i}>
                <td><ItemSel name={`l_${i}_item`} v={l?.itemId} /></td>
                <td><input name={`l_${i}_qty`} defaultValue={l ? q4(l.qty) : ''} inputMode="decimal" style={{ width: 90 }} /></td>
                <td><input name={`l_${i}_price`} defaultValue={l ? q4(l.price) : ''} inputMode="decimal" style={{ width: 100 }} /></td>
                <td><input name={`l_${i}_lot`} defaultValue={l?.lot ?? ''} style={{ width: 120 }} /></td>
                <td><input type="date" name={`l_${i}_exp`} defaultValue={l?.expiry ?? ''} /></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="mini">Вредноста = количина × цена (од фактурата за донација / проценка). Книжење: Д залиха / П приход од донации; лотот и рокот на траење одат во „🏷 Лотови и рок“ (FEFO).</p>
          <div className="row" style={{ gap: 8 }}><button className="btn pri">Зачувај приемница</button><Link className="btn" href="/obroci?t=z">Откажи</Link></div>
        </BankForm>
      </div>
    );
  }

  const issuedV = (d: string) => (I.get(d) ?? []).reduce((s, x) => s + x.value, 0);
  const norm = S.norm ?? {};
  return (
    <>
      <div className="card">
        <h2 style={{ margin: '0 0 6px' }}>⚙ Магацин на кујната и норматив по порција</h2>
        {write ? (
          <BankForm action={mealNormAction}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="f">Магацин на кујната<select name="wh" defaultValue={S.wh ?? 'main'}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              <label className="f" title="Д трошок на потрошените намирници (НПО план: 400 Потрошени материјали; инаку 4000)">Конто за трошок<input name="konto" defaultValue={S.konto ?? ''} placeholder="4000" style={{ width: 90 }} /></label>
              <span className="f">Оброци што се даваат
                <span className="row" style={{ gap: 10 }}>{MEALS.map(([k, n]) => <label key={k} className="chk"><input type="checkbox" name={`kind_${k}`} value="1" defaultChecked={kinds.includes(k)} /> {n}</label>)}</span>
              </span>
            </div>
            <p className="mini">Само означените оброци се во дневната листа, извештаите и издатниците; веќе внесените штикли на другите оброци не се бришат, само не се прикажуваат.</p>
            <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 8 }}>
              {KM.map(([k, n]) => {
                const L0 = norm[k] ?? [];
                const rows = [...L0, ...Array.from({ length: Math.max(3, 8 - L0.length) }, () => null)];
                return (
                  <table key={k} className="dense" style={{ minWidth: 300 }}>
                    <thead><tr><th colSpan={2}>{n} – за 1 порција</th></tr></thead>
                    <tbody>{rows.map((r, i) => (
                      <tr key={i}><td><ItemSel name={`n_${k}_${i}_item`} v={r?.itemId} /></td><td><input name={`n_${k}_${i}_qty`} defaultValue={r ? q4(r.qty) : ''} inputMode="decimal" placeholder="0,15" style={{ width: 70 }} /> {r ? unit(r.itemId) : ''}</td></tr>
                    ))}</tbody>
                  </table>
                );
              })}
            </div>
            <p className="mini">Количината е по една порција во единицата мерка на артиклот (на пр. 0,15 kg леб, 0,2 l млеко). Артиклите се од Шифрарник → Артикли (вид материјал / стока).</p>
            <button className="btn pri">Зачувај норматив</button>
          </BankForm>
        ) : (
          <p className="mini">{KM.map(([k, n]) => `${n}: ${(norm[k] ?? []).map((x) => `${nm(x.itemId)} ${q4(x.qty)} ${unit(x.itemId)}`).join(', ') || '—'}`).join(' · ')}</p>
        )}
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 6px' }}>📤 Издатница за потрошените намирници (порции × норматив)</h2>
        <form className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <input type="hidden" name="t" value="z" />
          <label className="f">Од<input type="date" name="od" defaultValue={from} /></label>
          <label className="f">До<input type="date" name="do" defaultValue={to} /></label>
          <button className="btn">Прикажи</button>
        </form>
        {write && (
          <BankForm action={issueMealsAction} confirm={`Да се издадат намирниците за ${dmy(from)} – ${dmy(to)} (по еден документ за ден)?`}>
            <input type="hidden" name="od" value={from} /><input type="hidden" name="do" value={to} />
            <button className="btn pri" style={{ marginTop: 6 }}>📤 Издај / ажурирај за периодот</button>
          </BankForm>
        )}
        <table className="dense" style={{ marginTop: 8 }}>
          <thead><tr><th>Датум</th>{KM.map(([k, n]) => <th key={k} className="n">{n}</th>)}<th>Потребно по норматив</th><th className="n">Издадено (ден.)</th><th>Статус</th></tr></thead>
          <tbody>
            {days.map((d) => {
              const p = P.get(d) ?? { b: 0, l: 0, d: 0 };
              const want = mealConsumption(p, norm), had = I.get(d) ?? [];
              const same = want.length === had.length && want.every((w) => had.some((h) => h.itemId === w.itemId && Math.abs(h.qty - w.qty) < 1e-4));
              return (
                <tr key={d}>
                  <td>{dmy(d)}</td>{KM.map(([k]) => <td key={k} className="n">{p[k]}</td>)}
                  <td className="mini">{want.map((w) => `${nm(w.itemId)} ${q4(w.qty)} ${unit(w.itemId)}`).join(', ') || '—'}</td>
                  <td className="n">{had.length ? fmt(issuedV(d)) : ''}</td>
                  <td>{!want.length && !had.length ? <span className="muted">—</span> : same ? <span className="pill good">✓ издадено</span> : had.length ? <span className="pill warn">сменето – издај повторно</span> : <span className="pill">за издавање</span>}</td>
                </tr>
              );
            })}
            {!days.length && <tr><td colSpan={4 + KM.length} className="muted">Нема оброци во периодот.</td></tr>}
          </tbody>
          <tfoot><tr className="tot"><td colSpan={2 + KM.length}>Вкупно издадено</td><td className="n">{fmt([...I.keys()].reduce((s, d) => s + issuedV(d), 0))}</td><td /></tr></tfoot>
        </table>
        <p className="note">Еден документ (издатница) за секој ден; кога ќе се сменат штиклите во дневната листа, издатницата на тој ден се ажурира сама. Заклучен период не се менува. Цената е просечната набавна цена од магацинот.</p>
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 6px' }}>📥 Приемници на донации во добра</h2>
        {write && <Link className="btn pri" href="/obroci?t=z&pr=new">+ Приемница на донација</Link>}
        <table className="dense" style={{ marginTop: 8 }}>
          <thead><tr><th>Бр.</th><th>Датум</th><th>Договор / донатор</th><th>Артикли (лот, рок)</th><th className="n">Вредност</th><th>Конто</th>{write && <th />}</tr></thead>
          <tbody>
            {R.map((r) => {
              const d = D.find((x) => x.id === r.donationId);
              return (
                <tr key={r.id}>
                  <td>{r.number}</td><td>{dmy(r.date)}</td><td>{d ? `${d.number} · ${d.pn ?? ''}` : <span className="muted">без договор</span>}</td>
                  <td className="mini">{r.lines.map((l) => `${nm(l.itemId)} ${q4(l.qty)} ${unit(l.itemId)}${l.lot ? ` [${l.lot}]` : ''}${l.expiry ? ` до ${dmy(l.expiry)}` : ''}`).join('; ')}</td>
                  <td className="n">{fmt(r.total)}</td><td>{r.account ?? '—'}</td>
                  {write && <td style={{ whiteSpace: 'nowrap' }}><Link className="btn sm" href={`/obroci?t=z&pr=${r.id}`}>✎</Link> <RowAction label="🗑" title="Избриши" confirm={`Да се избрише приемницата ${r.number} (и нејзиното книжење)?`} action={deleteDonReceiptAction.bind(null, r.id)} /></td>}
                </tr>
              );
            })}
            {!R.length && <tr><td colSpan={7} className="muted">Нема приемници на донации.</td></tr>}
          </tbody>
        </table>
        <p className="note">Купените намирници влегуваат преку Влез (фактура од добавувач) или Приемници и издатници во истиот магацин.</p>
      </div>
    </>
  );
}

/** Stock part of the 📊 report: kitchen warehouse, received / used / left per item, real cost per portion. */
export async function KitchenReport({ firm, from, to, portions }: { firm: Firm; from: string; to: string; portions: number }) {
  const S = mealStockSettings(firm);
  const [M, L] = await Promise.all([kitchenMoves(db(), firm.id, S.wh, to), loadStockContext(db(), firm.id)]);
  if (!M.length) return null;
  const K = kitchenReport(M, from, to, portions);
  const nm = (id: string) => L.items.get(id)?.name ?? '?';
  const un = (id: string) => L.items.get(id)?.unit ?? '';
  const rows = K.rows.filter((r) => r.open || r.inQ || r.useQ || r.othQ || r.close).sort((a, b) => nm(a.itemId).localeCompare(nm(b.itemId), 'mk'));
  return (
    <>
      <h3>Залиха на кујната – примено / потрошено / останато</h3>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
        <span className="pill">Примено: <b>{fmt(K.tot.inV)}</b> ден. (од тоа донации {fmt(K.tot.donV)})</span>
        <span className="pill warn">Потрошено за оброци: <b>{fmt(K.tot.useV)}</b> ден.</span>
        <span className="pill">Останато: <b>{fmt(K.tot.closeV)}</b> ден.</span>
        <span className="pill good">Реален трошок по порција (од залиха): <b>{fmt(K.perPortion)}</b> ден.</span>
      </div>
      <table className="dense">
        <thead><tr><th>Артикл</th><th>Ед.</th><th className="n">Почетна</th><th className="n">Примено</th><th className="n">од тоа донации</th><th className="n">За оброци</th><th className="n">Друго издадено</th><th className="n">Останато</th><th className="n">Вредност потрошено</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.itemId}><td>{nm(r.itemId)}</td><td>{un(r.itemId)}</td><td className="n">{q4(r.open)}</td><td className="n">{q4(r.inQ)}</td><td className="n">{r.donQ ? q4(r.donQ) : ''}</td><td className="n">{q4(r.useQ)}</td><td className="n">{r.othQ ? q4(r.othQ) : ''}</td><td className="n">{q4(r.close)}</td><td className="n">{fmt(r.useV)}</td></tr>
        ))}</tbody>
        <tfoot><tr className="tot"><td colSpan={8}>Вкупно потрошено за оброци</td><td className="n">{fmt(K.tot.useV)}</td></tr></tfoot>
      </table>
    </>
  );
}
