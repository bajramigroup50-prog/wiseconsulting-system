'use server';
/**
 * Card reconciliation (legacy `VIEWS.recon` 12933, `recParse` 12918, `recMatch` 12923) and the free comparison of two
 * cards (legacy `VIEWS.recFree` 13756 / `rfRun` v431). Read-only: the uploaded card is parsed in memory, nothing is stored.
 * Excel / CSV are read here; PDF / image cards need the AI read (not ported yet — see the note on the screen).
 */
import * as XLSX from 'xlsx';
import { splitCsv } from '@wise/core';
import { aggregatePrior, compareCards, ourRecRows, parseCardTable, recMatch, recSums, type TheirRow } from '@wise/core/finance';
import { requireUser } from '@/lib/auth';
import { currentFirm, currentYear } from '@/lib/context';
import { finLines, partnerMap } from '@/lib/finance';
import { viewAllowed } from '@/lib/nav';

const MAX = 20 * 1024 * 1024;

async function readCard(f: FormDataEntryValue | null): Promise<{ rows: TheirRow[]; opening: number; name: string }> {
  if (!(f instanceof File) || !f.size) throw new Error('Изберете датотека.');
  if (f.size > MAX) throw new Error('Датотеката е преголема (најмногу 20 MB).');
  const nm = f.name.toLowerCase();
  let rows: unknown[][] = [];
  if (/\.(xlsx|xls)$/.test(nm)) {
    const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: true });
    for (const s of wb.SheetNames) {
      const r = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[s]!, { header: 1, raw: true, defval: '' });
      const P = parseCardTable(r);
      if (P && P.rows.length) return { ...P, name: f.name };
      if (!rows.length) rows = r;
    }
  } else if (/\.(csv|txt)$/.test(nm)) {
    rows = splitCsv(await f.text());
  } else {
    throw new Error('PDF и слики од картици сè уште не се читаат автоматски – извезете ја картицата во Excel или CSV.');
  }
  const P = parseCardTable(rows);
  if (!P || !P.rows.length) throw new Error(`„${f.name}“: не се препознаени колоните (датум, должи, побарува) или нема ставки.`);
  return { ...P, name: f.name };
}

async function guard() {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'kartici')) throw new Error('Немате пристап.');
  const firm = await currentFirm(u);
  if (!firm) throw new Error('Изберете фирма.');
  return { firm, year: await currentYear() };
}

const err = (e: unknown) => ({ error: e instanceof Error ? e.message : 'Не е прочитано.' });

/** Our card of the partner (selected kontos or 12/22/15/23) vs the uploaded card. */
export async function reconAction(form: FormData) {
  try {
    const { firm, year } = await guard();
    const pid = String(form.get('pid') ?? '');
    const P = await partnerMap(firm.id);
    const p = P.get(pid);
    if (!p) throw new Error('Изберете комитент.');
    const kontos = String(form.get('k') ?? '').split(/[,\s]+/).filter((x) => /^\d{1,10}$/.test(x));
    const y1 = Math.min(+(form.get('y1') ?? year) || year, +(form.get('y2') ?? year) || year), y2 = Math.max(+(form.get('y1') ?? year) || year, +(form.get('y2') ?? year) || year);
    const one = y1 === year && y2 === year;
    const from = one && /^\d{4}-\d{2}-\d{2}$/.test(String(form.get('from'))) ? String(form.get('from')) : `${y1}-01-01`;
    const to = one && /^\d{4}-\d{2}-\d{2}$/.test(String(form.get('to'))) ? String(form.get('to')) : `${y2}-12-31`;
    const their = await readCard(form.get('file'));
    const L = (await finLines(firm.id, from, to, { partnerId: pid, ...(kontos.length ? { kontos } : { accountRe: '^(12|22|15|23)' }) }))
      .filter((l) => l.kind !== 'close' && !(l.kind === 'open' && !l.date.startsWith(String(y1))));
    const ours = ourRecRows(L);
    const rows = aggregatePrior(their.rows, from, ours.some((o) => o.open));
    const M = recMatch(ours, rows);
    return { ok: true as const, partner: p.name, file: their.name, from, to, kontos: kontos.join(', ') || '12/22', M, sums: recSums(ours, rows, their.opening, M), opening: their.opening };
  } catch (e) { return err(e); }
}

/** Two arbitrary cards (legacy recFree). */
export async function compareAction(form: FormData) {
  try {
    await guard();
    const a = await readCard(form.get('a')), b = await readCard(form.get('b'));
    const m = String(form.get('mirror') ?? 'auto');
    const X = compareCards(a.rows, b.rows, m === 'auto' ? undefined : m === '1');
    if (!X) throw new Error('Во картиците нема ставки со датум.');
    return { ok: true as const, fa: a.name, fb: b.name, na: a.rows.length, nb: b.rows.length, X };
  } catch (e) { return err(e); }
}
