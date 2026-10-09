'use server';
/** Legacy construction ACT (10089): project + BOQ, situations, invoice, diary, cost links, settings. */
import { redirect } from 'next/navigation';
import { parseBoqPaste } from '@wise/core/industry';
import { invoiceSituation, linkCosts, saveDiary, saveIndustryConfig, saveProject, saveSituation } from '@wise/db';
import { indRun, num, nz, rows, str, today } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/gradba', '/gradbaIzv', '/izlez'];

export async function saveProjectAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const r = await indRun('cpSaveB', P, async ({ tx, a }) => {
    const boq = [
      ...rows(f, 'q', ['pos', 'desc', 'unit', 'qty', 'price'], (l) => !!l.desc).map((l) => ({ pos: l.pos, desc: l.desc, unit: l.unit, qty: nz(l.qty), price: nz(l.price) })),
      ...parseBoqPaste(String(f.get('paste') ?? '')).map((l) => ({ ...l, pos: l.pos ?? '', unit: l.unit ?? '', qty: Number(l.qty), price: Number(l.price) })),
    ];
    const x = await saveProject(tx, a, {
      id: str(f.get('id')) || null, code: str(f.get('code')), name: str(f.get('name')), site: str(f.get('site')), city: str(f.get('city')), investorId: str(f.get('inv')),
      cno: str(f.get('cno')), cdate: str(f.get('cdate')), start: str(f.get('start')), end: str(f.get('end')), nadzor: str(f.get('nadzor')), eng: str(f.get('eng')), art32: f.get('art32') === 'on', boq,
    });
    id = x.id;
    return `Објектот ${x.code} е зачуван.`;
  });
  if (r.error || str(f.get('id'))) return r;
  redirect(`/gradba?p=${id}`);
}

export async function saveSituationAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('csSave', P, async ({ tx, a }) => {
    const cum: Record<string, number> = {};
    for (const [k, v] of f.entries()) if (k.startsWith('cum.') && String(v).trim() !== '') cum[k.slice(4)] = nz(String(v));
    for (const [k, v] of f.entries()) if (k.startsWith('pct.') && String(v).trim() !== '' && !(k.slice(4) in cum)) cum[k.slice(4)] = Math.round(nz(str(f.get('bq.' + k.slice(4)))) * nz(String(v)) / 100 * 1e4) / 1e4;
    await saveSituation(tx, a, { id: str(f.get('id')) || null, projectId: str(f.get('proj')), no: str(f.get('no')), kind: str(f.get('kind')) === 'fin' ? 'fin' : 'int', date: str(f.get('date')), from: str(f.get('from')), to: str(f.get('to')), cum });
    return 'Ситуацијата е зачувана.';
  });
}

export async function invoiceSituationAction(id: string): Promise<FormState> {
  return indRun('csInv', P, async ({ tx, a }) => `Издадена е фактура ${(await invoiceSituation(tx, a, id, today())).number}.`);
}

export async function saveDiaryAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('cdSave', P, async ({ tx, a }) => {
    const workers = f.getAll('w').map(String).map((emp) => ({ emp, name: str(f.get('wn.' + emp)), hrs: nz(str(f.get('wh.' + emp))) || 8, rate: 0 }));
    await saveDiary(tx, a, {
      id: str(f.get('id')) || null, projectId: str(f.get('proj')), date: str(f.get('date')), weather: str(f.get('weather')), temp: str(f.get('temp')), works: str(f.get('works')),
      mat: str(f.get('mat')), issues: str(f.get('issues')), nadzor: str(f.get('nadzor')), workers,
      mach: rows(f, 'm', ['name', 'hrs', 'rate'], (m) => !!m.name).map((m) => ({ name: m.name, hrs: nz(m.hrs), rate: nz(m.rate) })),
    });
    return 'Записот е зачуван.';
  });
}

export async function linkCostsAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('pcLink', P, async ({ tx, a }) => {
    const refs = f.getAll('pc').map(String).map((x) => { const [type, id] = x.split(':'); return { type: type as 'purchase', id: id! }; });
    if (!refs.length) return 'Штиклирајте документи.';
    return `Поврзани ${await linkCosts(tx, a, str(f.get('proj')), refs, f.get('unlink') === '1')} документи.`;
  });
}

export async function saveConsConfigAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('consCfgSave', P, async ({ tx, a }) => {
    await saveIndustryConfig(tx, a, 'cons', { hr: num(f.get('hr')) ?? 0, revK: str(f.get('revK')), rate: Number(f.get('rate')) || 18 });
    return 'Зачувано.';
  });
}
