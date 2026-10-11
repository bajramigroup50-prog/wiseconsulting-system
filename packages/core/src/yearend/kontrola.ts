/**
 * „Контрола на завршна сметка“ steps 1, 2, 3 and 5 (legacy `zkExpect` / `zkMapped` / `zkData` 10882–10892):
 * trial balance totals, balances on the "wrong" side per class, accounts with a balance outside every AOP rule,
 * and the six AOP cross-checks.
 */
import type { YeTrialBalanceRow } from './balances';
import type { ZsRule } from './aop';

/** Expected side per class (legacy `ZK_SIDE`): d = debit (+), p = credit (−). */
export const ZK_SIDE: Readonly<Record<string, 'd' | 'p'>> = { 0: 'd', 1: 'd', 2: 'p', 3: 'd', 4: 'd', 6: 'd', 7: 'p', 9: 'p' };

/** Legacy `zkExpect`: the side an account's balance is expected on, or null (not checked). */
export function zkExpect(k: string, name: string): 'd' | 'p' | null {
  const n = String(name || '').toLowerCase();
  const c = String(k)[0] ?? '';
  if (/^(99|8)/.test(k)) return null;
  if (/исправк|акумулирана амортиз|отпис на вредн/.test(n)) return c === '0' || c === '1' ? 'p' : ZK_SIDE[c] ?? null;
  if (c === '9' && (/^90[12]/.test(k) || /^96/.test(k) || /загуба|откупени|неуплатен/.test(n))) return 'd';
  if (c === '7' && /^70/.test(k)) return 'd';
  if (c === '2' && /^(13|23)/.test(k)) return null;
  return ZK_SIDE[c] ?? null;
}

/** Legacy `zkMapped`: does any AOP rule (account prefixes, `!` excludes) take this account? */
export function zkMapped(k: string, rules: readonly Pick<ZsRule, 'k'>[]): boolean {
  for (const x of rules) {
    if (!x.k) continue;
    const L = String(x.k).split(/[,; ]+/).filter(Boolean);
    const inc = L.filter((p) => !p.startsWith('!')), exc = L.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
    if (inc.some((p) => k.startsWith(p)) && !exc.some((p) => k.startsWith(p))) return true;
  }
  return false;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface ZkData {
  TD: number; TP: number;
  sign: { k: string; s: number; e: 'd' | 'p' }[];
  unm: { k: string; s: number }[];
}

/** Steps 1–3 from the trial balance without the close (opening included). */
export function zkData(tb: readonly YeTrialBalanceRow[], names: Readonly<Record<string, string>>, rules: readonly Pick<ZsRule, 'k'>[]): ZkData {
  let TD = 0, TP = 0;
  const sign: ZkData['sign'] = [], unm: ZkData['unm'] = [];
  for (const r of tb) {
    const d = (+r.debit || 0) + (+(r.openingDebit ?? 0) || 0), p = (+r.credit || 0) + (+(r.openingCredit ?? 0) || 0);
    TD += d; TP += p;
    const s = r2(d - p);
    if (Math.abs(s) < 0.5) continue;
    const e = zkExpect(r.account, names[r.account] ?? '');
    if (e && ((e === 'd' && s < 0) || (e === 'p' && s > 0))) sign.push({ k: r.account, s, e });
    if (/^[0-79]/.test(r.account) && !zkMapped(r.account, rules)) unm.push({ k: r.account, s });
  }
  const byK = (a: { k: string }, b: { k: string }) => a.k.localeCompare(b.k);
  return { TD: r2(TD), TP: r2(TP), sign: sign.sort(byK), unm: unm.sort(byK) };
}

/** Step 5 (legacy `zkData` A): [label, left, right]. */
export function zkAopChecks(V: Readonly<Record<string, number>>, dbV: Readonly<Record<string, number>>): [string, number, number][] {
  const g = (a: string) => Math.round(V[a] || 0);
  return [
    ['ВКУПНА АКТИВА (АОП 063) = ВКУПНА ПАСИВА (АОП 111)', g('bs063'), g('bs111')],
    ['Вонбилансна актива (АОП 064) = вонбилансна пасива (АОП 112)', g('bs064'), g('bs112')],
    ['Нето добивка БУ (АОП 255) = Добивка за деловната година БС (АОП 077)', g('bu255'), g('bs077')],
    ['Нето загуба БУ (АОП 256) = Загуба за деловната година БС (АОП 078)', g('bu256'), g('bs078')],
    ['Добивка/загуба пред оданочување БУ (250−251) = ДБ АОП 01', g('bu250') - g('bu251'), Math.round(dbV['01'] || 0)],
    ['Данок на добивка БУ (АОП 252) = ДБ АОП 56', g('bu252'), Math.round(dbV['56'] || 0)],
  ];
}
