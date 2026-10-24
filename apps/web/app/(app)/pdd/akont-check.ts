/** УЈП „Аконтативна пресметка“ import: the amounts by the chosen income types against the PDF's. */
import { pddCalc, type PddType } from '@wise/core/finance';
import type { AkontRow } from '@wise/core/pdd-akont';

const fmt = (v: number) => Math.round(v).toLocaleString('de-DE');

/** One message per recipient whose ПДД or net (by the type's rates) differs from the PDF by more than 1 denar. */
export function akontMismatch(rows: readonly AkontRow[], tids: readonly string[], T: readonly PddType[]): string[] {
  const out: string[] = [];
  rows.forEach((r, i) => {
    const t = T.find((x) => x.id === tids[i]);
    if (!t) return;
    const c = pddCalc({ mode: 'g', amt: r.gross }, t);
    if (Math.abs(c.tax - r.tax) <= 1 && Math.abs(c.net - r.net) <= 1) return;
    out.push(`${r.name}: по „${t.sh || t.pod}“ ПДД ${fmt(c.tax)} / нето ${fmt(c.net)}, во PDF ПДД ${fmt(r.tax)} / нето ${fmt(r.net)}`);
  });
  return out;
}
