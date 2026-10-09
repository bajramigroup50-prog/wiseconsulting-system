'use server';
/** Legacy rent-a-car ACT (9809, 11715) and fleet / settings (`rcFleetSave` 9840, `rcCfgSave` 9841). */
import { redirect } from 'next/navigation';
import {
  cancelRental, handOut, importFleetFromAssets, invoiceRental, receiveDeposit, returnVehicle, saveIndustryConfig, saveRental, saveVehicle, settleDeposit,
} from '@wise/db';
import { indRun, nowLocal, num, nz, rows, str, today } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/rent', '/flota', '/rentIzv', '/izlez', '/blagajna', '/pnalozi', '/frTuri'];

const driverOf = (f: FormData) => Object.fromEntries(['name', 'birth', 'addr', 'doc', 'docType', 'docExp', 'lic', 'licFrom', 'licExp', 'licCat', 'phone', 'email', 'nat', 'embg', 'emerg'].map((k) => [k, str(f.get('d_' + k))])) as { name: string };

export async function saveRentalAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const r = await indRun('rcSaveB', P, async ({ tx, a }) => {
    const x = await saveRental(tx, a, {
      id: str(f.get('id')) || null, vehicleId: str(f.get('veh')), from: str(f.get('from')), to: str(f.get('to')), driver: driverOf(f), driver2: str(f.get('driver2')),
      partnerId: str(f.get('partner')) || null, deposit: num(f.get('deposit')), note: str(f.get('note')), pDay: num(f.get('pDay')),
      countries: str(f.get('countries')).split(/[,\s]+/).filter(Boolean).map((c) => c.toUpperCase()), green: f.get('green') === 'on',
      extras: rows(f, 'x', ['name', 'qty', 'price'], (r) => !!r.name && nz(r.price) > 0).map((r) => ({ name: r.name!, qty: nz(r.qty!) || 1, price: nz(r.price!) })),
    });
    id = x.id;
    return `Договорот ${x.number} е зачуван.`;
  });
  if (r.error || str(f.get('id'))) return r;
  redirect(`/rent?id=${id}`);
}

export async function handoverAction(_p: FormState, f: FormData): Promise<FormState> {
  const id = str(f.get('id')), kind = str(f.get('kind'));
  return indRun(kind === 'out' ? 'rcOut' : 'rcRet', P, async ({ tx, a }) => {
    const h = { km: num(f.get('km')), fuel: num(f.get('fuel')), dmg: str(f.get('dmg')) };
    if (kind === 'out') {
      const x = await handOut(tx, a, id, h, nowLocal(), today());
      return 'Возилото е предадено.' + (x.ageWarning ? ' ' + x.ageWarning : '');
    }
    const due = await returnVehicle(tx, a, id, h, nowLocal());
    return `Возилото е примено. За плаќање ${due.toFixed(2)} ден.`;
  });
}

export async function rentalStepAction(id: string, step: 'inv' | 'dep' | 'cancel'): Promise<FormState> {
  return indRun(step === 'inv' ? 'rcInv' : step === 'dep' ? 'rcDepIn' : 'rcCancel', P, async ({ tx, a }) => {
    if (step === 'inv') { const x = await invoiceRental(tx, a, id, today()); return `Издадена е фактура ${x.number}.`; }
    if (step === 'dep') return `Кауцијата е примена (уплатница ${await receiveDeposit(tx, a, id, today())}).`;
    await cancelRental(tx, a, id);
    return 'Резервацијата е откажана.';
  });
}

export async function settleDepositAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('rcDepBack', P, async ({ tx, a }) => {
    const x = await settleDeposit(tx, a, str(f.get('id')), num(f.get('keep')) ?? 0, today());
    return `Кауцијата е порамнета: задржано ${x.kept.toFixed(2)}, вратено ${x.back.toFixed(2)}.`;
  });
}

export async function saveVehicleAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('rcFleetSave', P, async ({ tx, a }) => {
    await saveVehicle(tx, a, {
      id: str(f.get('id')) || null, plate: str(f.get('plate')), name: str(f.get('name')), trailer: f.get('trailer') === 'on', active: f.get('active') !== 'off', rent: f.get('rent') === 'on',
      rClass: str(f.get('rClass')), rDay: num(f.get('rDay')), rWeek: num(f.get('rWeek')), rDep: num(f.get('rDep')), rKm: num(f.get('rKm')), rKmX: num(f.get('rKmX')),
      odo: num(f.get('odo')), fuelNorm: num(f.get('fuelNorm')), capKg: num(f.get('capKg')), oilEvery: num(f.get('oilEvery')), oilLastKm: num(f.get('oilLastKm')),
      tyreEvery: num(f.get('tyreEvery')), tyreLastKm: num(f.get('tyreLastKm')), regExp: str(f.get('regExp')), insExp: str(f.get('insExp')), techExp: str(f.get('techExp')),
    });
    return 'Возилото е зачувано.';
  });
}

export async function importFleetAction(): Promise<FormState> {
  return indRun('rcFleetSave', P, async ({ tx, a }) => `Додадени ${await importFleetFromAssets(tx, a)} возила од основните средства.`);
}

export async function saveRentConfigAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('rcCfgSave', P, async ({ tx, a }) => {
    await saveIndustryConfig(tx, a, 'rent', {
      rate: Number(f.get('rate')) || 18, revK: str(f.get('revK')), depK: str(f.get('depK')) || '2222', fuel8: num(f.get('fuel8')) ?? 0, grace: num(f.get('grace')) ?? 0,
      minAge: num(f.get('minAge')) ?? 0, minLic: num(f.get('minLic')) ?? 0, sPct: num(f.get('sPct')) ?? 0, sFrom: str(f.get('sFrom')) || '06-15', sTo: str(f.get('sTo')) || '09-15', terms: String(f.get('terms') ?? ''),
    });
    return 'Поставките се зачувани.';
  });
}
