'use server';
/** Legacy hotel ACT (9575, 9613): reservations, check-in/out, invoice, rooms, settings. */
import { redirect } from 'next/navigation';
import {
  checkIn, checkOut, importHotelReservations, importHotelRooms, invoiceReservation, issueReservationAdvance, markPaidAtTill, saveIndustryConfig, saveReservation, saveRoom,
  setReservationCharges, setReservationStatus, setRoomClean,
} from '@wise/db';
import { indRun, isDate, num, nz, rows, str, today } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/hotel', '/hotelSoby', '/hotelKniga', '/izlez'];

export async function saveReservationAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const r = await indRun('htSaveB', P, async ({ tx, a }) => {
    const x = await saveReservation(tx, a, {
      id: str(f.get('id')) || null, roomId: str(f.get('room')), from: str(f.get('from')), to: str(f.get('to')), guestName: str(f.get('guestName')),
      phone: str(f.get('phone')), email: str(f.get('email')), adults: num(f.get('adults')), children: num(f.get('children')), price: num(f.get('price')),
      board: str(f.get('board')), partnerId: str(f.get('partner')) || null, src: str(f.get('src')), advance: num(f.get('advance')), note: str(f.get('note')), noTax: f.get('noTax') === 'on',
      guests: rows(f, 'g', ['name', 'birth', 'nat', 'doc', 'docNo', 'sex', 'police', 'pol'], (g) => !!g.name)
        .map(({ pol, police, ...g }) => ({ ...g, name: g.name!, police: pol === 'on' ? police || new Date().toISOString() : '' })),
    });
    id = x.id;
    return `Резервацијата ${x.number} е зачувана.`;
  });
  if (r.error || str(f.get('id'))) return r;
  redirect(`/hotel?id=${id}`);
}

export async function addChargeAction(_p: FormState, f: FormData): Promise<FormState> {
  const id = str(f.get('id'));
  return indRun('htSaveB', P, async ({ tx, a }) => {
    const cur = JSON.parse(str(f.get('charges')) || '[]');
    const name = str(f.get('cname'));
    if (!name || !(nz(str(f.get('cprice'))) > 0)) return 'Внесете опис и цена.';
    await setReservationCharges(tx, a, id, [...cur, { date: today(), name, itemId: str(f.get('citem')) || null, qty: nz(str(f.get('cqty'))) || 1, price: nz(str(f.get('cprice'))), rate: Number(f.get('crate')) || 10 }]);
    return 'Додадено.';
  });
}
export async function removeChargeAction(id: string, charges: unknown[], i: number): Promise<FormState> {
  return indRun('htSaveB', P, async ({ tx, a }) => { await setReservationCharges(tx, a, id, (charges as never[]).filter((_, k) => k !== i)); return 'Отстрането.'; });
}

export async function reservationStepAction(id: string, step: 'in' | 'out' | 'cancel' | 'noshow' | 'inv' | 'adv' | 'till'): Promise<FormState> {
  return indRun(step === 'inv' ? 'htInv' : step === 'in' ? 'htIn' : step === 'out' ? 'htOut' : 'htSaveB', P, async ({ tx, a }) => {
    if (step === 'in') {
      const x = await checkIn(tx, a, id, today());
      return 'Гостите се пријавени.' + (x.foreigners ? ` 🛂 Пријавете ги ${x.foreigners} странци во полиција во рок од 24 часа.` : '') + (x.incomplete ? ` ${x.incomplete} гости немаат датум на раѓање или документ.` : '');
    }
    if (step === 'out') { await checkOut(tx, a, id, today()); return 'Гостинот е одјавен. Издадете фактура или означете „Платено на фискална каса“.'; }
    if (step === 'inv') { const x = await invoiceReservation(tx, a, id, today()); return `Издадена е фактура ${x.number}.${x.warnings.length ? ' ' + x.warnings.join(' ') : ''}`; }
    if (step === 'adv') { const x = await issueReservationAdvance(tx, a, id, today()); return `Издадена е авансна фактура ${x.number}.`; }
    if (step === 'till') { await markPaidAtTill(tx, a, id); return 'Означено како платено на каса.'; }
    await setReservationStatus(tx, a, id, step);
    return step === 'cancel' ? 'Резервацијата е откажана.' : 'Означено: гостинот не дојде.';
  });
}

export async function saveRoomAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('htRoomSave', P, async ({ tx, a }) => {
    await saveRoom(tx, a, { id: str(f.get('id')) || null, no: str(f.get('no')), kind: str(f.get('kind')), beds: num(f.get('beds')), floor: str(f.get('floor')), price: num(f.get('price')), active: f.get('active') === 'on' });
    return 'Собата е зачувана.';
  });
}
export async function cleanRoomAction(id: string): Promise<FormState> {
  return indRun('htClean', P, async ({ tx, a }) => { await setRoomClean(tx, a, id); return 'Собата е подготвена.'; });
}

export async function saveHotelConfigAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('htCfgSave', P, async ({ tx, a }) => {
    const age = (k: string) => (str(f.get(k)) === '' ? '' : Number(f.get(k)));
    await saveIndustryConfig(tx, a, 'hotel', {
      tax: num(f.get('tax')) ?? 0, freeAge: age('freeAge'), halfAge: age('halfAge'), rate: Number(f.get('rate')) || 5,
      revK: str(f.get('revK')), taxK: str(f.get('taxK')) || '2399', payer: str(f.get('payer')) === 'guest' ? 'guest' : '',
    });
    return 'Поставките се зачувани.';
  });
}

/** Excel rows posted by `XlsxImport` (JSON array of arrays, header first). */
const sheet = (f: FormData): unknown[][] => {
  try { const v = JSON.parse(str(f.get('rows')) || '[]'); return Array.isArray(v) ? v.filter(Array.isArray) : []; } catch { return []; }
};

/** Legacy dig bar `DIG.hroom` — rooms from Excel (template: Број, Тип, Легла, Кат, Цена по ноќ). */
export async function importRoomsAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('htRoomSave', P, async ({ tx, a }) => importHotelRooms(tx, a, sheet(f)));
}

/** Legacy dig bar `DIG.hres` — reservations from a Booking.com / Airbnb / Excel export. */
export async function importReservationsAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('htSaveB', P, async ({ tx, a }) => importHotelReservations(tx, a, sheet(f)));
}

void isDate;
