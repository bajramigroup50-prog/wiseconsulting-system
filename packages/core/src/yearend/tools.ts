/**
 * Year-end „⚙ Алатки“ and the short income statement (legacy `zs_aop` / `zs_pr` / `zs_skr` 7666–7730):
 * AOP list export (CSV / XML), rule editor template + Excel import, „Скратен биланс на успех“ rows.
 */
import type { ZsRule } from './aop';

/** Legacy `prTpl`: header + one row per rule. */
export function prTemplate(rules: readonly ZsRule[]): (string | number)[][] {
  return [['Образец', 'АОП', 'Назив', 'Конта', 'Знак', 'Формула'],
    ...rules.map((x) => [x.r === 'bu' ? 'Биланс на успех' : 'Биланс на состојба', x.aop, x.n, x.k, +x.s === -1 ? '-' : '+', x.f])];
}

/** Legacy `prImport`: columns found by header text; needs „АОП“ and „Назив“. */
export function prParse(rows: readonly (readonly unknown[])[]): ZsRule[] | { error: string } {
  const hd = (rows[0] ?? []).map((x) => String(x ?? '').toLowerCase());
  const ix = (n: string[]) => hd.findIndex((x) => n.some((y) => x.includes(y)));
  const iR = ix(['образец', 'извештај', 'report']), iA = ix(['аоп', 'aop']), iN = ix(['назив', 'позиција', 'опис', 'name']);
  const iK = ix(['конта', 'конто', 'kont']), iS = ix(['знак', 'sign']), iF = ix(['формула', 'formula']);
  if (iA < 0 || iN < 0) return { error: 'Excel мора да има колони „АОП“ и „Назив“.' };
  const s = (r: readonly unknown[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  return rows.slice(1).filter((r) => s(r, iA)).map((r) => {
    const rr = s(r, iR).toLowerCase();
    const aop = s(r, iA);
    return {
      r: /сост|бс|bs|актив|пасив/.test(rr) ? 'bs' : /успех|бу|bu/.test(rr) ? 'bu' : +aop < 200 ? 'bs' : 'bu',
      aop, n: s(r, iN), k: s(r, iK), s: iS >= 0 && /[-−п]/i.test(s(r, iS)) ? -1 : 1, f: s(r, iF),
    };
  });
}

/** Clean editor rows (legacy `prRead`: rows without AOP and name dropped). */
export function prClean(rows: readonly Partial<ZsRule>[]): ZsRule[] {
  return rows.map((x) => ({
    r: (x.r === 'bs' ? 'bs' : 'bu') as ZsRule['r'], aop: String(x.aop ?? '').trim().slice(0, 6), n: String(x.n ?? '').trim().slice(0, 300),
    k: String(x.k ?? '').trim().slice(0, 500), s: +(x.s ?? 1) === -1 ? -1 : 1, f: String(x.f ?? '').trim().slice(0, 300), ...(x.custom ? { custom: true } : {}),
  })).filter((x) => x.aop || x.n);
}

const xe = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Legacy `aopXml`: `AOP_<Y>.xml`. */
export function aopXml(year: number, firm: { edb?: string | null; embs?: string | null; name: string }, rules: readonly ZsRule[], C: Readonly<Record<string, number>>, P: Readonly<Record<string, number>>): string {
  const part = (r: 'bs' | 'bu') => {
    const tag = r === 'bs' ? 'BilansNaSostojba' : 'BilansNaUspeh';
    return `  <${tag}>\n${rules.filter((x) => x.r === r).map((x) => `    <AOP broj="${xe(x.aop)}" naziv="${xe(x.n)}" tekovna="${(C[r + x.aop] || 0).toFixed(0)}" prethodna="${(P[r + x.aop] || 0).toFixed(0)}"/>`).join('\n')}\n  </${tag}>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ZavrsnaSmetka godina="${year}" edb="${xe(firm.edb)}" embs="${xe(firm.embs)}" naziv="${xe(firm.name)}">\n${part('bs')}\n${part('bu')}\n</ZavrsnaSmetka>`;
}

/** Legacy `zs_skr`: [label, value(V), total row]. */
export function skrRows(V: Readonly<Record<string, number>>): [string, number, boolean][] {
  const u = (a: string) => V['bu' + a] || 0;
  return [
    ['Вкупни приходи', u('201') + u('205') + u('223') + u('244') + u('248'), false],
    ['Вкупни расходи', u('204') + u('207') + u('234') + u('245') + u('249'), false],
    ['Добивка / загуба пред оданочување', u('250') - u('251'), true],
    ['Данок на добивка', u('252'), false],
    ['Нето добивка / загуба', u('255') - u('256'), true],
  ];
}

/** Legacy `spData` 7652: revenue accounts 74–79 (balance without the close, credit = +) with their activity code. */
export function spRows(pre: Readonly<Record<string, { s: number }>>, names: Readonly<Record<string, string>>, actMap: Readonly<Record<string, string>>, activity: string) {
  const rows = Object.entries(pre).filter(([k]) => /^7[4-9]/.test(k)).map(([k, v]) => ({ k, n: names[k] ?? '', v: Math.round(-v.s * 100) / 100, a: actMap[k] || activity || '' }))
    .filter((x) => Math.abs(x.v) > 0.009).sort((a, b) => a.k.localeCompare(b.k));
  const tot = Math.round(rows.reduce((s, x) => s + x.v, 0) * 100) / 100;
  const byA: Record<string, number> = {};
  for (const x of rows) byA[x.a || '—'] = Math.round(((byA[x.a || '—'] || 0) + x.v) * 100) / 100;
  return { rows, tot, byA };
}
