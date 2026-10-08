/**
 * Year-end phase gate: blocking findings before the year can be closed / exported (legacy `zcFindings` 11196 +
 * wrapper 16884 with `izvYearEnd` 16882, `zcOpen` 11221).
 *
 * Pure: the caller passes the ledger lines and the few document lists the checks read. Texts are plain (the legacy
 * strings carried <b> tags); `go`/`goSt` name the legacy view to jump to.
 *
 * Fix G1: the "depreciation not calculated" check only looked for a `dep-<Y>` journal; `vehicleOnly` assets are
 * excluded there AND (now) in `depFor`, so the two agree. (Gating of undoClose/openYear/lockYear — §8.4 item 15 — is
 * an application concern: every year-end action should call `zcOpen` before acting.)
 */
import { r2 } from '../money';

export interface ZcLine {
  k: string;
  d?: number;
  p?: number;
  partner?: string | null;
  date: string;
  /** legacy source label: 'Излез' (sales invoice), 'Влез' (purchase invoice), 'Почетна', … */
  src?: string;
}

export interface ZcInput {
  year: number;
  /** today's date YYYY-MM-DD (the bank year-end check only runs on/after 31.12) */
  today: string;
  /** ledger lines of the year WITHOUT the closing journal */
  lines: readonly ZcLine[];
  partnerName?: (id: string) => string | undefined;
  /** stock moves (all years) */
  moves?: readonly { item: string; qty: number; date?: string; pend?: boolean; wh?: string }[];
  items?: Readonly<Record<string, { name?: string; unit?: string; type?: string }>>;
  locName?: (id: string) => string;
  /** bank statement lines (all years) */
  bank?: readonly { date: string; ref?: unknown; konto?: string; acct?: string }[];
  /** bank accounts of the firm (legacy `banks()`; default one account `main`) */
  bankAccounts?: readonly { id: string; name?: string; account?: string }[];
  /** documents submitted by the client and not yet approved, any collection */
  pendingDocs?: readonly { date?: string; pend?: boolean }[];
  assets?: readonly { cost?: number | string; date?: string; vehicleOnly?: boolean }[];
  /** ids of the firm's journals (`dep-2025`, `close-2025`, …) */
  journalIds?: readonly string[];
  invoices?: readonly { date: string; partner?: string | null; pend?: boolean }[];
  purchases?: readonly { date: string; partner?: string | null; pend?: boolean; cash?: boolean }[];
}

export type ZcSeverity = 'block' | 'warn';
export interface ZcFinding {
  key: string;
  sev: ZcSeverity;
  area: string;
  txt: string;
  go?: string;
  goSt?: Record<string, string>;
}

const fmt = (n: number) => (+n || 0).toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fi = (n: number) => (+n || 0).toLocaleString('mk-MK', { maximumFractionDigits: 0 });
const dmy = (d: string) => (d ? String(d).split('-').reverse().join('.') : '');
const r4 = (n: number) => Math.round((+n || 0) * 10000) / 10000;

/** Bank accounts whose last statement of the year is not dated 31.12 (legacy `izvYearEnd`). */
export function izvYearEnd(Y: number, bank: ZcInput['bank'] = [], accounts?: ZcInput['bankAccounts']) {
  const end = Y + '-12-31';
  const out: { acct: string; name: string; last: string; after: boolean }[] = [];
  const accts = accounts && accounts.length ? accounts : [{ id: 'main', name: 'Трансакциска сметка', account: '' }];
  for (const bk of accts) {
    const all = bank.filter((x) => (x.acct || 'main') === bk.id);
    if (!all.length) continue;
    const inY = all.filter((x) => String(x.date).startsWith(String(Y))).map((x) => String(x.date)).sort();
    const before = all.some((x) => String(x.date) < Y + '-01-01');
    if (!inY.length && !before) continue;
    const last = inY[inY.length - 1] || '';
    if (last === end) continue;
    const after = all.some((x) => String(x.date) > end);
    out.push({ acct: bk.id, name: bk.name || bk.account || 'сметка', last, after });
  }
  return out;
}

export function zcFindings(inp: ZcInput): ZcFinding[] {
  const Y = inp.year;
  const end = Y + '-12-31';
  const L = inp.lines;
  const out: ZcFinding[] = [];
  const add = (key: string, sev: ZcSeverity, area: string, txt: string, go?: string, goSt?: Record<string, string>) =>
    out.push({ key, sev, area, txt, ...(go ? { go } : {}), ...(goSt ? { goSt } : {}) });
  const pn = (id: string) => inp.partnerName?.(id) || '(без партнер)';

  // 1. trial balance
  {
    const D = r2(L.reduce((s, l) => s + (+(l.d ?? 0) || 0), 0));
    const P = r2(L.reduce((s, l) => s + (+(l.p ?? 0) || 0), 0));
    if (Math.abs(D - P) >= 0.01) add('bb', 'block', 'Бруто биланс', `Не е изедначен: должи ${fmt(D)} / побарува ${fmt(P)} (разлика ${fmt(D - P)})`, 'bilanc');
  }
  // 2. partners: paid / collected without an invoice
  const by: Record<string, { d: number; p: number; n: number; inv: number }> = {};
  for (const l of L) {
    const k = String(l.k);
    if (!/^(12|22)/.test(k)) continue;
    const key = (k.startsWith('12') ? '12' : '22') + '|' + (l.partner || '');
    const b = (by[key] ??= { d: 0, p: 0, n: 0, inv: 0 });
    b.d += +(l.d ?? 0) || 0;
    b.p += +(l.p ?? 0) || 0;
    b.n++;
    if (l.src === 'Излез' || l.src === 'Влез') b.inv++;
  }
  for (const [key, b] of Object.entries(by)) {
    const [g, pid] = key.split('|') as [string, string];
    const s = r2(b.d - b.p);
    if (!pid && Math.abs(s) >= 1) {
      add('np' + g, 'block', 'Партнери', `Конто ${g}..: ${fmt(Math.abs(s))} ден. салдо без партнер – распоредете го по купувачи / добавувачи`, 'kkart', { kkK: g === '12' ? '1200' : '2200' });
      continue;
    }
    if (g === '12' && s <= -1)
      add('p12|' + pid, 'block', 'Купувачи', `${pn(pid)}: наплатено ${fmt(-s)} ден. повеќе отколку фактурирано${b.inv ? '' : ' – нема ниту една фактура'} (аванс или недостасува фактура)`, 'kartici', { pid });
    if (g === '22' && s >= 1)
      add('p22|' + pid, 'block', 'Добавувачи', `${pn(pid)}: платено ${fmt(s)} ден. повеќе отколку примени фактури${b.inv ? '' : ' – нема ниту една влезна фактура'} (аванс или недостасува фактура)`, 'kartici', { pid });
  }
  // 3. cash and bank: running balance per day
  const run = (pre: string, name: string, sev: ZcSeverity, go: string) => {
    const R = L.filter((l) => String(l.k).startsWith(pre));
    let s = 0;
    let min = 0;
    let minD = '';
    let first = '';
    const byD: Record<string, number> = {};
    for (const l of R) byD[l.date] = (byD[l.date] || 0) + (+(l.d ?? 0) || 0) - (+(l.p ?? 0) || 0);
    for (const d of Object.keys(byD).sort()) {
      s = r2(s + byD[d]!);
      if (s < -0.009 && !first) first = d;
      if (s < min) {
        min = s;
        minD = d;
      }
    }
    if (min < -0.009) add('neg' + pre, sev, name, `Салдото оди во минус: најмалку ${fmt(min)} ден. на ${dmy(minD)} (прв пат на ${dmy(first)})${s < -0.009 ? ` · на крајот ${fmt(s)}` : ''}`, go);
  };
  run('102', 'Благајна', 'block', 'blagajna');
  run('100', 'Банка', 'warn', 'banka');
  // 4. stock below zero during or at the end of the year
  {
    const g: Record<string, { qty: number; date: string }[]> = {};
    for (const mv of inp.moves ?? []) {
      if (mv.pend || !mv.date || mv.date > end) continue;
      const it = inp.items?.[mv.item];
      if (!it || it.type === 'service') continue;
      const k = mv.item + '|' + (mv.wh || 'main');
      (g[k] ??= []).push({ qty: mv.qty, date: mv.date });
    }
    for (const [k, M] of Object.entries(g)) {
      M.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      let q = 0;
      let min = 0;
      let minD = '';
      for (const mv of M) {
        q = r4(q + (+mv.qty || 0));
        if (q < min - 1e-9) {
          min = q;
          minD = mv.date;
        }
      }
      if (min < -1e-9) {
        const [iid, wh] = k.split('|') as [string, string];
        const it = inp.items?.[iid] ?? {};
        add(
          'st|' + k,
          'block',
          'Залиха',
          `${it.name || iid}${wh !== 'main' ? ' (' + (inp.locName ? inp.locName(wh) : wh) + ')' : ''}: залихата во минус ${fi(min)} ${it.unit || ''} на ${dmy(minD)}${q < -1e-9 ? ' · на крајот ' + fi(q) : ''} – недостасува приемница или е погрешна количина`,
          'zaliha',
        );
      }
    }
  }
  // 5. unposted bank lines, client documents waiting, depreciation
  {
    const n = (inp.bank ?? []).filter((b) => String(b.date).startsWith(String(Y)) && !b.ref && !b.konto).length;
    if (n) add('bank', 'block', 'Изводи', `${n} ставки од изводи не се прокнижени`, 'banka');
  }
  {
    const n = (inp.pendingDocs ?? []).filter((x) => x.pend && String(x.date || '').startsWith(String(Y))).length;
    if (n) add('pend', 'block', 'Од клиентот', `${n} документи од клиентот чекаат одобрување`, 'klInbox');
  }
  {
    const has = (inp.assets ?? []).some((a) => !a.vehicleOnly && (+(a.cost ?? 0) || 0) > 0 && String(a.date || '') <= end);
    if (has && !(inp.journalIds ?? []).includes('dep-' + Y)) add('dep', 'block', 'Основни средства', `Амортизацијата за ${Y} не е пресметана`, 'os');
  }
  // 6. invoices without partner
  {
    const n = (inp.invoices ?? []).filter((i) => String(i.date).startsWith(String(Y)) && !i.partner && !i.pend).length;
    if (n) add('invnp', 'block', 'Фактури', `${n} излезни фактури без купувач`, 'izlez');
  }
  {
    const n = (inp.purchases ?? []).filter((i) => String(i.date).startsWith(String(Y)) && !i.partner && !i.pend && !i.cash).length;
    if (n) add('purnp', 'warn', 'Фактури', `${n} влезни фактури без добавувач`, 'vlez');
  }
  // 7. (wrapper 16884) last bank statement of the year must be dated 31.12
  if (inp.today >= end) {
    for (const x of izvYearEnd(Y, inp.bank, inp.bankAccounts))
      out.push({
        key: 'izvEnd|' + x.acct,
        sev: 'block',
        area: 'Изводи',
        txt: `${x.name}: последниот извод за ${Y} е ${x.last ? 'од ' + dmy(x.last) : 'нема ниту еден'} – годината се затвора со извод од 31.12.${Y}. Ако по ${x.last ? dmy(x.last) : 'почетокот'} немало промет, означете „проверено“ (со потврда/салдо од банката на 31.12).`,
        go: 'banka',
      });
  }
  return out;
}

/** Blocking findings that were not acknowledged (`firm.zsAck[year][key]`) — legacy `zcOpen`. */
export function zcOpen(findings: readonly ZcFinding[], ack: Readonly<Record<string, unknown>> | null | undefined): ZcFinding[] {
  const A = ack ?? {};
  return findings.filter((x) => x.sev === 'block' && !A[x.key]);
}
