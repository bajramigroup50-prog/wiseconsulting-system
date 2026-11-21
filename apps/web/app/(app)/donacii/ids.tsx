/**
 * Образец УЈП-ИДС/ПР — „Извештај за примена донација / спонзорство“ (Закон за донации и спонзорства во јавните
 * дејности, чл. 19: the recipient submits it to УЈП within 30 days of the fulfilment of the contract). Same sections as
 * the official form: опис на донацијата, примател, давател (+ крајниот корисник), прилози, составувач, потписник.
 * Annex: the proof of the intended use — the 🍲 meals of the period and the приемници of the donated goods.
 */
import { Fragment } from 'react';
import type { Donation, DonationReceiptRow, Firm, Partner } from '@wise/db';
import { IDS_DAYS, IDS_WHAT, idsDue, idsFulfilled, idsWhatOf } from '@wise/core/npo';
import { dmy, fmt } from '@/lib/fmt';

export type IdsMeals = { from: string; to: string; families: number; meals: number; portions: number; days: number } | null;

const dots = (w = 40) => <span style={{ display: 'inline-block', minWidth: `${w}mm`, borderBottom: '1px dotted #000' }}>&nbsp;</span>;
const Box = ({ on }: { on: boolean }) => <span style={{ display: 'inline-block', width: '4mm', height: '4mm', border: '1px solid #000', textAlign: 'center', lineHeight: '4mm', fontSize: '8pt', marginRight: '2mm' }}>{on ? 'X' : ''}</span>;
const H = ({ t }: { t: string }) => <tr><th colSpan={2} style={{ textAlign: 'left', background: '#eee', padding: '1.5mm 2mm' }}>{t}</th></tr>;
const R = ({ k, v }: { k: React.ReactNode; v: React.ReactNode }) => <tr><td style={{ width: '42%', padding: '1.2mm 2mm' }}>{k}</td><td style={{ padding: '1.2mm 2mm' }}>{v || dots()}</td></tr>;

export function IdsReport({ d, firm, partner, receipts, meals, pi, nameOf }: {
  d: Donation; firm: Firm; partner?: Partner; receipts: readonly DonationReceiptRow[]; meals: IdsMeals; pi: { no?: string | null; date?: string | null }; nameOf: (id: string) => string;
}) {
  const S = (firm.settings ?? {}) as { signer?: string; signerRole?: string };
  const what = idsWhatOf(d);
  const amount = Number(d.confAmount ?? d.amount) || 0;
  const recTot = receipts.reduce((s, r) => s + Number(r.total), 0);
  const val = d.inKind && recTot ? recTot : amount;
  const pd = (partner?.data ?? {}) as { embg?: string };
  const fulfilled = idsFulfilled(d);
  const due = idsDue(d);
  const goodsQty = d.inKind ? (d.inKindDesc || '') + (receipts.length ? ` (${receipts.length} приемници, спецификација во прилог)` : '') : '';
  const sub = (k: string) => (what === k ? (k === 'money' ? `${fmt(val)} денари` : '') : '');
  return (
    <div style={{ fontSize: '10pt', lineHeight: 1.35 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '3mm' }}><tbody><tr>
        <td style={{ border: '1px solid #000', padding: '2mm', width: '55%', fontSize: '8.5pt' }}>Пополнува Управа за јавни приходи – датум и број на прием<div style={{ height: '10mm' }} /></td>
        <td style={{ textAlign: 'right', verticalAlign: 'top' }}><b>Образец УЈП-ИДС/ПР</b></td>
      </tr></tbody></table>
      <h2 style={{ textAlign: 'center', margin: '0' }}>ИЗВЕШТАЈ</h2>
      <h3 style={{ textAlign: 'center', margin: '0 0 3mm' }}>за примена {d.kind === 'sponsorship' ? 'спонзорство' : 'донација'}</h3>
      <table className="dense" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <H t="ОПИС НА ДОНАЦИЈАТА / СПОНЗОРСТВОТО" />
          {IDS_WHAT.map(([k, n]) => k === 'goods' ? (
            <Fragment key={k}>
              <R k={<><Box on={what === 'goods'} />Добра или услуги – количина</>} v={what === 'goods' ? goodsQty : ''} />
              <R k={<><Box on={what === 'goods'} />Добра или услуги – износ</>} v={what === 'goods' ? `${fmt(val)} денари${d.inKind ? ' (вредност на добрата)' : ''}` : ''} />
            </Fragment>
          ) : (
            <R key={k} k={<><Box on={what === k} />{n}{k === 'money' ? ' – износ' : k === 'other' ? ' – количина и вид' : ' – вид и износ'}</>} v={sub(k)} />
          ))}
          {d.purpose && <R k="Намена" v={d.purpose} />}
          <H t="ПОДАТОЦИ ЗА ПРИМАТЕЛОТ" />
          <R k="Даночен број / ЕМБГ" v={firm.edb ?? ''} />
          <R k="Назив" v={firm.name} />
          <R k="Адреса / седиште" v={[firm.address, firm.city].filter(Boolean).join(', ')} />
          <R k="Е-пошта" v={firm.email ?? ''} />
          <R k="Телефон" v={firm.phone ?? ''} />
          <H t="ПОДАТОЦИ ЗА ДАВАТЕЛОТ" />
          <R k="Даночен број / ЕМБГ на давателот" v={partner?.edb || pd.embg || ''} />
          <R k="Даночен број / ЕМБГ на крајниот корисник" v={`${firm.edb ?? ''} (${firm.name})`} />
          <R k="Назив" v={partner?.name ?? d.partnerName ?? ''} />
          <R k="Адреса / седиште" v={[partner?.address, partner?.city].filter(Boolean).join(', ')} />
          <R k="Е-пошта" v={partner?.email ?? ''} />
          <R k="Телефон" v={partner?.phone ?? ''} />
          <H t="ПРИЛОЗИ" />
          <tr><td colSpan={2} style={{ padding: '1.5mm 2mm' }}>
            <ol style={{ margin: 0, paddingLeft: '5mm' }}>
              <li>Договор за {d.kind === 'sponsorship' ? 'спонзорство' : 'донација'} бр. {d.number ?? dots(15)} од {dmy(d.date)}</li>
              <li>Решение на Министерството за правда за потврдување на јавниот интерес бр. {pi.no || dots(20)} од {pi.date ? dmy(pi.date) : dots(20)}</li>
              <li>Потврда за {d.kind === 'sponsorship' ? 'примено спонзорство' : 'примена донација'} бр. {d.confNumber || dots(15)} од {d.confDate ? dmy(d.confDate) : dots(20)}</li>
              <li>Доказ за наменско користење на {d.kind === 'sponsorship' ? 'спонзорството' : 'донацијата'}{meals ? ' (евиденција на поделени оброци и корисници' + (receipts.length ? ', спецификација на примените добра' : '') + ')' : ''}</li>
            </ol>
          </td></tr>
          <H t="ПОДАТОЦИ ЗА СОСТАВУВАЧОТ" />
          <R k="Име и презиме / назив" v="" />
          <R k="Даночен број / ЕМБГ" v="" />
          <R k="Датум на пополнување" v="" />
          <R k="Својство" v="" />
          <R k="Потпис" v="" />
          <H t="ПОДАТОЦИ ЗА ПОТПИСНИКОТ" />
          <R k="Име и презиме" v={S.signer ?? ''} />
          <R k="ЕМБГ" v="" />
          <R k="Датум на пополнување" v="" />
          <R k="Својство" v={S.signerRole ?? 'Претседател на здружението'} />
          <R k="Потпис" v={<span style={{ display: 'inline-block', width: '100%', textAlign: 'right' }}>М.П.</span>} />
        </tbody>
      </table>
      <p style={{ fontSize: '8.5pt', margin: '2mm 0 0' }}>
        Рок: {IDS_DAYS} дена од исполнувањето на договорот (член 19 од Законот за донации и за спонзорства во јавните дејности).
        {fulfilled && <> Договорот е исполнет на {dmy(fulfilled)} → рок до <b>{dmy(due!)}</b>.</>}
      </p>

      {(meals || receipts.length > 0) && (
        <div style={{ breakBefore: 'page' }}>
          <h3 style={{ textAlign: 'center' }}>Прилог 4 – Доказ за наменско користење</h3>
          <p>{firm.name} · {d.kind === 'sponsorship' ? 'спонзорство' : 'донација'} бр. {d.number} од {partner?.name ?? d.partnerName ?? ''}</p>
          {meals && (
            <table className="dense" style={{ width: '100%', marginBottom: '4mm' }}>
              <thead><tr><th colSpan={2}>Народна кујна – поделени оброци {dmy(meals.from)} – {dmy(meals.to)}</th></tr></thead>
              <tbody>
                <tr><td>Семејства / лица корисници</td><td className="n">{meals.families}</td></tr>
                <tr><td>Денови со поделени оброци</td><td className="n">{meals.days}</td></tr>
                <tr><td>Оброци (појадок, ручек, вечера)</td><td className="n">{meals.meals}</td></tr>
                <tr><td>Порции (оброци × членови на семејството)</td><td className="n">{meals.portions}</td></tr>
              </tbody>
            </table>
          )}
          {receipts.length > 0 && (
            <table className="dense" style={{ width: '100%' }}>
              <thead><tr><th>Приемница</th><th>Датум</th><th>Добра (количина, лот, рок)</th><th className="n">Вредност</th></tr></thead>
              <tbody>{receipts.map((r) => (
                <tr key={r.id}><td>{r.number}</td><td>{dmy(r.date)}</td><td>{r.lines.map((l) => `${nameOf(l.itemId)} ${String(l.qty).replace('.', ',')}${l.lot ? ` [${l.lot}]` : ''}${l.expiry ? ` до ${dmy(l.expiry)}` : ''}`).join('; ')}{r.note ? ` · ${r.note}` : ''}</td><td className="n">{fmt(r.total)}</td></tr>
              ))}</tbody>
              <tfoot><tr className="tot"><td colSpan={3}>Вкупно</td><td className="n">{fmt(recTot)}</td></tr></tfoot>
            </table>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12mm' }}>
            <div style={{ textAlign: 'center', minWidth: '65mm' }}>{S.signer ?? ''}<div style={{ height: '12mm' }} /><div style={{ borderTop: '1px solid #000' }}>потпис и печат</div></div>
          </div>
        </div>
      )}
    </div>
  );
}
