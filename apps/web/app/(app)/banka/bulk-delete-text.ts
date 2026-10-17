/** Confirm / result text of „🗑 Избриши ги сите изводи“ (bank-view.tsx → actions.ts). */
import type { BulkStatementsPlan } from '@wise/db';
import { dmy, fmt } from '@/lib/fmt';

const no = (n: string | null) => (n ? `бр. ${n}` : 'без број');

/** Skipped statements (locked period / locked nalog), at most 20 listed. */
export function bulkSkippedText(p: BulkStatementsPlan): string {
  if (!p.skipped.length) return '';
  const L = p.skipped.slice(0, 20).map((s) => `  • ${dmy(s.date)} ${no(s.number)} – ${s.why}`);
  if (p.skipped.length > 20) L.push(`  … уште ${p.skipped.length - 20}`);
  return `\n\nПрескокнати (заклучен период / налог) ${p.skipped.length}:\n${L.join('\n')}`;
}

/** Preview appended to the confirm: per account count, first/last number and date, inflow / outflow, posted. */
export function bulkPreviewText(p: BulkStatementsPlan, range: { from: string; to: string }): string {
  const head = `\n\nПериод ${dmy(range.from)} – ${dmy(range.to)}: ${p.total} изводи (${p.posted} прокнижени – нивните налози ќе се избришат, ${p.total - p.posted} непрокнижени).`;
  const A = p.accounts.map((a) =>
    `\n• ${a.name}: ${a.count} изводи (${a.lines} ставки), од ${no(a.firstNo)} / ${dmy(a.firstDate ?? '')} до ${no(a.lastNo)} / ${dmy(a.lastDate ?? '')}; ` +
    `прилив ${fmt(a.inflow)}, одлив ${fmt(a.outflow)}; прокнижени ${a.posted}`);
  return head + A.join('') + bulkSkippedText(p) + '\n\nОва не може да се врати.';
}
