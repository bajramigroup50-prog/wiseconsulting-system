'use server';
/** „🍲 Корисници и оброци“: register, daily meal ticks and the import of the association's Excel register. */
import * as XLSX from 'xlsx';
import { redirect } from 'next/navigation';
import { isMealKind, parseRegister } from '@wise/core/meals';
import { StockDocError, setConsentMany, deleteDonationReceipt, importBeneficiaries, issueMealDays, reissueIfIssued, saveBeneficiary, saveDonationReceipt, saveMealStockSettings, setConsent, setMeal, setMealsBulk, type IssueResult } from '@wise/db';
import { MEALS } from '@wise/core/meals';
import { dmy } from '@/lib/fmt';
import { indRun, num, str } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/obroci'];

/** `indRun`, plus the stock services' user errors (no stock, unknown item / warehouse) shown on the form. */
async function stockRun(action: string, fn: Parameters<typeof indRun>[2], paths = P): Promise<FormState> {
  try { return await indRun(action, paths, fn); } catch (e) { if (e instanceof StockDocError) return { error: e.message }; throw e; }
}
const iso = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');

export async function saveBenefAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('mealBenSave', P, async ({ tx, a }) => {
    await saveBeneficiary(tx, a, {
      id: str(f.get('id')) || null, no: num(f.get('no')), name: str(f.get('name')), members: num(f.get('members')) ?? 1,
      nationality: str(f.get('nationality')), embg: str(f.get('embg')), place: str(f.get('place')), phone: str(f.get('phone')),
      note: str(f.get('note')), active: f.get('active') !== 'off',
      ...(f.has('consentDate') ? { consentDate: iso(str(f.get('consentDate'))) || null } : {}),
    });
    return 'Корисникот е зачуван.';
  });
}

/** One checkbox of the daily list (called from the client on every click). */
export async function toggleMealAction(id: string, date: string, meal: string, on: boolean): Promise<FormState> {
  if (!iso(date) || !isMealKind(meal)) return { error: 'Невалиден датум или оброк.' };
  return stockRun(on ? 'mealOn' : 'mealOff', async ({ tx, a }) => {
    await setMeal(tx, a, id, date, meal, on);
    // the day already has a kitchen issue → it follows the ticks (one document per day)
    const r = await reissueIfIssued(tx, a, date);
    return (on ? 'Означено.' : 'Тргнато.') + (r?.short.length ? ' ⚠ Издатницата не е сменета – нема доволно залиха.' : '');
  }, []);
}

export async function bulkMealAction(ids: string[], date: string, meal: string): Promise<FormState> {
  if (!iso(date) || !isMealKind(meal)) return { error: 'Невалиден датум или оброк.' };
  return stockRun('mealBulk', async ({ tx, a }) => {
    const n = await setMealsBulk(tx, a, ids, date, meal);
    await reissueIfIssued(tx, a, date);
    return `Означени ${n} корисници.`;
  });
}

export async function importBenefAction(_p: FormState, f: FormData): Promise<FormState> {
  const file = f.get('file');
  if (!(file instanceof File) || !file.size) return { error: 'Изберете Excel датотека (.xlsx).' };
  if (file.size > 5_000_000) return { error: 'Датотеката е преголема (најмногу 5 MB).' };
  let parsed: ReturnType<typeof parseRegister>;
  try {
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    // the first sheet that has a name column (the association's „Regjistri“; „Përmbledhje“ is only a summary)
    parsed = { list: [], skipped: 0 };
    for (const n of wb.SheetNames) {
      const r = parseRegister(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n]!, { header: 1, raw: false, defval: '' }));
      if (r.list.length) { parsed = r; break; }
    }
  } catch { return { error: 'Датотеката не може да се прочита. Зачувајте ја како .xlsx и обидете се повторно.' }; }
  if (!parsed.list.length) return { error: 'Не е најдена колона со име (Emri dhe Mbiemri / Име и презиме).' };
  return indRun('mealImport', P, async ({ tx, a }) => {
    const r = await importBeneficiaries(tx, a, parsed.list);
    return `Увезено: ${r.added} нови, ${r.updated} ажурирани${parsed.skipped ? `, ${parsed.skipped} редови без име прескокнати` : ''}.`;
  });
}

/** Consent of a beneficiary: date (empty = clears it) and the scanned signed form. */
export async function consentAction(_p: FormState, f: FormData): Promise<FormState> {
  const d = str(f.get('consentDate'));
  if (d && !iso(d)) return { error: 'Невалиден датум.' };
  const files = f.getAll('fileIds').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  return indRun('mealConsent', P, async ({ tx, a }) => {
    await setConsent(tx, a, str(f.get('id')), d || null, files);
    return d ? 'Согласноста е евидентирана.' : 'Согласноста е тргната (без согласност).';
  });
}

/** Kitchen settings: warehouse, expense konto and the normative per meal kind (rows `n_<meal>_<i>_item` / `_qty`). */
export async function mealNormAction(_p: FormState, f: FormData): Promise<FormState> {
  const norm: Record<string, { itemId: string; qty: number }[]> = {};
  for (const [k] of MEALS) {
    norm[k] = [];
    for (let i = 0; i < 40; i++) {
      const itemId = str(f.get(`n_${k}_${i}_item`)), qty = num(f.get(`n_${k}_${i}_qty`));
      if (itemId && qty && qty > 0) norm[k]!.push({ itemId, qty });
    }
  }
  return stockRun('mealNorm', async ({ tx, a }) => {
    const kinds = MEALS.map(([k]) => k).filter((k) => f.get(`kind_${k}`) === '1');
    if (!kinds.length) throw new StockDocError('Изберете барем еден оброк што се дава.');
    await saveMealStockSettings(tx, a, { wh: str(f.get('wh')) || null, konto: str(f.get('konto')) || null, norm, kinds });
    return 'Нормативите се зачувани.';
  });
}

const issueMsg = (r: IssueResult) => {
  if (r.noNorm) return 'Прво внесете норматив (артикли по порција) за појадок / ручек / вечера.';
  const p = [`Издадени ${r.issued.length} дена`, r.removed.length ? `тргнати ${r.removed.length} дена без оброци` : '', r.same ? `${r.same} дена веќе издадени (без промена)` : ''].filter(Boolean).join(', ');
  const sh = r.short.length ? ` ⚠ Нема доволно залиха за ${[...new Set(r.short.map((x) => dmy(x.date)))].join(', ')}: ${[...new Set(r.short.map((x) => x.item))].slice(0, 6).join(', ')} – внесете приемница па издајте повторно.` : '';
  const lk = r.locked.length ? ` 🔒 Заклучен период (не се менува): ${r.locked.map(dmy).join(', ')}.` : '';
  return p + '.' + sh + lk;
};

/** Issue the kitchen consumption (portions × normative) for a period, one издатница per day. */
export async function issueMealsAction(_p: FormState, f: FormData): Promise<FormState> {
  const from = iso(str(f.get('od'))), to = iso(str(f.get('do')));
  if (!from || !to) return { error: 'Внесете период.' };
  return stockRun('mealIssue', async ({ tx, a }) => issueMsg(await issueMealDays(tx, a, from, to)));
}

/** Приемница of a donation in kind (rows `l_<i>_item`, `_qty`, `_price`, `_lot`, `_exp`). */
export async function donReceiptAction(_p: FormState, f: FormData): Promise<FormState> {
  const lines: { itemId: string; qty: number; price: number; lot: string | null; expiry: string | null }[] = [];
  for (let i = 0; i < 60; i++) {
    const itemId = str(f.get(`l_${i}_item`));
    if (!itemId) continue;
    lines.push({ itemId, qty: num(f.get(`l_${i}_qty`)) ?? 0, price: num(f.get(`l_${i}_price`)) ?? 0, lot: str(f.get(`l_${i}_lot`)) || null, expiry: iso(str(f.get(`l_${i}_exp`))) || null });
  }
  const st = await stockRun('donRecSave', async ({ tx, a }) => {
    const r = await saveDonationReceipt(tx, a, {
      id: str(f.get('id')) || null, donationId: str(f.get('donationId')) || null, date: str(f.get('date')), wh: str(f.get('wh')) || null,
      account: str(f.get('account')) || null, note: str(f.get('note')) || null, lines,
    });
    return `Приемницата ${r.number} е зачувана.`;
  });
  // back to the list (a second click on the open editor would make a second receipt)
  if (st.ok) redirect('/obroci?t=z');
  return st;
}

export async function deleteDonReceiptAction(id: string): Promise<FormState> {
  return stockRun('donRecDel', async ({ tx, a }) => { await deleteDonationReceipt(tx, a, id); return 'Приемницата е избришана.'; });
}

/** One click on the pill of the register: set / change (`date`) or remove (`null`) the consent. */
export async function quickConsentAction(id: string, date: string | null): Promise<FormState> {
  if (date && !iso(date)) return { error: 'Невалиден датум.' };
  return indRun('mealConsent', P, async ({ tx, a }) => { await setConsentMany(tx, a, [id], date); return date ? 'Согласноста е потврдена.' : 'Согласноста е тргната.'; });
}

/** „✓ Потврди согласност за избраните“: the ticked rows of the register (`sel`) get the date. */
export async function bulkConsentAction(_p: FormState, f: FormData): Promise<FormState> {
  const date = iso(str(f.get('date')));
  if (!date) return { error: 'Внесете датум.' };
  const ids = f.getAll('sel').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return { error: 'Означете ги корисниците (кутичките лево).' };
  return indRun('mealConsent', P, async ({ tx, a }) => `Согласност потврдена за ${await setConsentMany(tx, a, ids, date)} корисници (${dmy(date)}).`);
}
