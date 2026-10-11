'use server';
/** Legacy `pnSvcDone` 9481 („✓ Направен сега“) and the Excel import of the fleet's transport data. */
import { importTravelVehicles, travelServiceDone } from '@wise/db';
import { indRun, num, str, today } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/pnGorivo', '/pnalozi'];

export async function serviceDoneAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('pnSvcDone', P, async ({ tx, a }) => {
    const t = str(f.get('t')) === 'tyre' ? 'tyre' : 'oil';
    await travelServiceDone(tx, a, str(f.get('veh')), t, num(f.get('km')) ?? 0, today());
    return 'Запишано.';
  });
}

export async function importVehiclesAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('write', P, async ({ tx, a }) => {
    const rows = JSON.parse(str(f.get('rows')) || '[]') as string[][];
    const [add, upd] = await importTravelVehicles(tx, a, rows);
    return `Увезени возила: нови ${add}, ажурирани ${upd}.`;
  });
}
