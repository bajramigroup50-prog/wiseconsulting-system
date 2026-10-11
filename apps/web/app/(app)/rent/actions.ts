'use server';
/** Legacy rent-a-car ACT (9809, 11715) and fleet / settings (`rcFleetSave` 9840, `rcCfgSave` 9841). */
import { redirect } from 'next/navigation';
import {
  cancelRental, handOut, importFleetFromAssets, importFleetPrices, invoiceRental, receiveDeposit, returnVehicle, saveIndustryConfig, saveRental, saveVehicle, settleDeposit,
} from '@wise/db';
import { indRun, nowLocal, num, nz, rows, str, today } from '@/lib/industry';
import { markAiReadsSaved } from '@/lib/ai';
import { storeImageDataUrl } from '@/lib/data-url-file';
import type { FormState } from '@/components/bank-form';

const P = ['/rent', '/flota', '/rentIzv', '/izlez', '/blagajna', '/pnalozi', '/frTuri'];

const driverOf = (f: FormData) => ({
  ...Object.fromEntries(['name', 'birth', 'addr', 'doc', 'docType', 'docExp', 'docIss', 'lic', 'licFrom', 'licExp', 'licCat', 'phone', 'email', 'nat', 'embg', 'emerg'].map((k) => [k, str(f.get('d_' + k))])),
  // legacy 11685 / 11674: exit authorisation, copies of the scanned documents
  auth: f.get('auth') === 'on',
  scans: str(f.get('scans')).split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20),
}) as unknown as { name: string };
const countriesOf = (f: FormData) => {
  const c = [...new Set(f.getAll('ct').map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))];
  return c.length ? (c.includes('MK') ? c : ['MK', ...c]) : str(f.get('countries')).split(/[,\s]+/).filter(Boolean).map((x) => x.toUpperCase());
};

export async function saveRentalAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const r = await indRun('rcSaveB', P, async ({ tx, a }) => {
    const x = await saveRental(tx, a, {
      id: str(f.get('id')) || null, vehicleId: str(f.get('veh')), from: str(f.get('from')), to: str(f.get('to')), driver: driverOf(f), driver2: str(f.get('driver2')),
      partnerId: str(f.get('partner')) || null, deposit: num(f.get('deposit')), note: str(f.get('note')), pDay: num(f.get('pDay')),
      countries: countriesOf(f), green: f.get('green') === 'on',
      extras: rows(f, 'x', ['name', 'qty', 'price'], (r) => !!r.name && nz(r.price) > 0).map((r) => ({ name: r.name!, qty: nz(r.qty!) || 1, price: nz(r.price!) })),
    });
    id = x.id;
    if (str(f.get('scanRead'))) await markAiReadsSaved(tx, a.firmId, [str(f.get('scanRead'))]);
    return `Договорот ${x.number} е зачуван.`;
  });
  if (r.error) return r;
  // legacy `rcSavePdf` („💾 Зачувај и 🖨 договор“)
  if (f.get('andPdf')) redirect(`/rent/dogovor?id=${id}`);
  if (str(f.get('id'))) return r;
  redirect(`/rent?id=${id}`);
}

export async function handoverAction(_p: FormState, f: FormData): Promise<FormState> {
  const id = str(f.get('id')), kind = str(f.get('kind'));
  return indRun(kind === 'out' ? 'rcOut' : 'rcRet', P, async ({ tx, a, u }) => {
    // legacy handover photos (`rh_*_ph`) and the customer's signature (`sg_rc_*`) → files
    const photos: string[] = [];
    for (const k of ['ph1', 'ph2', 'ph3']) { const fid = await storeImageDataUrl(tx, { firmId: a.firmId, userId: u.id, dataUrl: str(f.get(k)), name: `rent-${kind}-${id.slice(0, 8)}-${k}` }); if (fid) photos.push(fid); }
    const sig = await storeImageDataUrl(tx, { firmId: a.firmId, userId: u.id, dataUrl: str(f.get('sig')), name: `rent-potpis-${kind}-${id.slice(0, 8)}` });
    const h = { km: num(f.get('km')), fuel: str(f.get('fuel')) === '' ? null : num(f.get('fuel')), dmg: str(f.get('dmg')), photos, sig };
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

/** Legacy dig bar `DIG.fleet` — rent prices of the fleet from Excel (plate, vehicle, class, prices, deposit, km). */
export async function importFleetPricesAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('rcFleetSave', P, async ({ tx, a }) => {
    let rows: unknown = [];
    try { rows = JSON.parse(str(f.get('rows')) || '[]'); } catch { rows = []; }
    return importFleetPrices(tx, a, (Array.isArray(rows) ? rows : []).filter(Array.isArray) as unknown[][]);
  });
}
