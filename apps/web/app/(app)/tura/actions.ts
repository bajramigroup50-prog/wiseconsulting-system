'use server';
/** Legacy travel-agency ACT (11928, 11987): arrangements, bookings, payments, invoices, advance offset, margin VAT. */
import { redirect } from 'next/navigation';
import {
  addBookingPayment, cancelBooking, invoiceBooking, postTravelVat, removeBookingPayment, saveArrangement, saveBooking, saveIndustryConfig, settleBookingAdvance,
} from '@wise/db';
import { indRun, isDate, num, nz, rows, str, today } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/tura', '/turaIzv', '/izlez', '/blagajna', '/vlez', '/ddv'];

export async function saveArrangementAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const r = await indRun('taSave', P, async ({ tx, a }) => {
    const x = await saveArrangement(tx, a, {
      id: str(f.get('id')) || null, code: str(f.get('code')), name: str(f.get('name')), dest: str(f.get('dest')), from: str(f.get('from')) || null, to: str(f.get('to')) || null,
      kind: str(f.get('kind')) === 'agent' ? 'agent' : 'own', seats: num(f.get('seats')), price: num(f.get('price')), priceCh: num(f.get('priceCh')), comm: num(f.get('comm')),
      countries: str(f.get('countries')).split(/[,\s]+/).filter(Boolean), prog: str(f.get('prog')), incl: str(f.get('incl')), excl: str(f.get('excl')),
      status: (['open', 'full', 'done', 'cancel'].includes(str(f.get('status'))) ? str(f.get('status')) : 'open') as 'open',
      costs: rows(f, 'c', ['cat', 'who', 'desc', 'amt', 'cur', 'fx', 'purchaseId'], (c) => !!c.purchaseId || nz(c.amt) !== 0)
        .map((c) => ({ cat: c.cat, who: c.who, desc: c.desc, amt: nz(c.amt), cur: c.cur || 'MKD', fx: nz(c.fx) || 1, purchaseId: c.purchaseId || null })),
    });
    id = x.id;
    return `Аранжманот ${x.code} е зачуван.`;
  });
  if (r.error || str(f.get('id'))) return r;
  redirect(`/tura?a=${id}`);
}

export async function saveBookingAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '', arr = '';
  const r = await indRun('tbSave', P, async ({ tx, a }) => {
    arr = str(f.get('arr'));
    const x = await saveBooking(tx, a, {
      id: str(f.get('id')) || null, arrangementId: arr, client: { name: str(f.get('cname')), phone: str(f.get('cphone')), email: str(f.get('cemail')), addr: str(f.get('caddr')) },
      partnerId: str(f.get('partner')) || null, adults: num(f.get('adults')), children: num(f.get('children')), extra: num(f.get('extra')), disc: num(f.get('disc')), priceTot: num(f.get('priceTot')),
      room: str(f.get('room')), note: str(f.get('note')),
      pax: rows(f, 'p', ['name', 'birth', 'nat', 'doc', 'docExp'], (p) => !!p.name),
    });
    id = x.id;
    return `Пријавата ${x.number} е зачувана.${x.warning ? ' ' + x.warning : ''}`;
  });
  if (r.error || str(f.get('id'))) return r;
  redirect(`/tura?a=${arr}&b=${id}`);
}

export async function bookingPayAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('tbPay', P, async ({ tx, a }) => {
    const how = (['cash', 'bank', 'card'].includes(str(f.get('how'))) ? str(f.get('how')) : 'cash') as 'cash';
    const d = isDate(str(f.get('date'))) ? str(f.get('date')) : today();
    const no = await addBookingPayment(tx, a, str(f.get('id')), { date: d, amt: num(f.get('amt')) ?? 0, how });
    return `Уплатата е евидентирана${no ? ` (уплатница ${no})` : ''}.`;
  });
}

export async function bookingStepAction(id: string, step: 'inv' | 'adv' | 'cancel' | `rm${number}`): Promise<FormState> {
  return indRun(step === 'inv' ? 'tbInv' : step === 'adv' ? 'tbAdv' : 'tbSave', P, async ({ tx, a }) => {
    if (step === 'inv') { const x = await invoiceBooking(tx, a, id, today()); return `Издадена е фактура ${x.number}.`; }
    if (step === 'adv') return `Пребиен аванс ${(await settleBookingAdvance(tx, a, id, today())).toFixed(2)} ден.`;
    if (step === 'cancel') { await cancelBooking(tx, a, id); return 'Пријавата е откажана.'; }
    await removeBookingPayment(tx, a, id, Number(step.slice(2)));
    return 'Уплатата е отстранета.';
  });
}

export async function postTravelVatAction(period: string): Promise<FormState> {
  return indRun('tuVatPost', P, async ({ tx, a }) => `Книжено: ДДВ на маржа ${(await postTravelVat(tx, a, period)).toFixed(2)} ден.`);
}

export async function saveTravelConfigAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('taCfgSave', P, async ({ tx, a }) => {
    await saveIndustryConfig(tx, a, 'travel', {
      revK: str(f.get('revK')), advK: str(f.get('advK')), passKonto: str(f.get('passKonto')) || '2290', comm: num(f.get('comm')) ?? 0,
      agg: str(f.get('agg')) === 'arr' ? 'arr' : 'period', lic: str(f.get('lic')), guar: str(f.get('guar')), terms: String(f.get('terms') ?? ''),
    });
    return 'Поставките се зачувани.';
  });
}
