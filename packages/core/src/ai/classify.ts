/**
 * Office inbox file classification (legacy final `irClassify` 14044 + `IR_K` 14022/14047): the model's kind →
 * the inbox route of `INBOX_ROUTES`. Legacy `fiscal` is the `fisk` route here; `other` means "archive only" (no route).
 */
import type { InboxRoute } from '../office/portal';

export const CLASSIFY_KINDS = ['purchase', 'sale', 'bank', 'fiscal', 'payroll', 'employee', 'cash', 'stock', 'travel', 'dossier', 'other'] as const;
export type ClassifyKind = (typeof CLASSIFY_KINDS)[number];

export interface InboxClassification { kind: ClassifyKind | null; route: InboxRoute | null; what: string }

export function inboxClassification(r: unknown): InboxClassification {
  const o = (r && typeof r === 'object' ? r : {}) as { kind?: string; what?: string };
  const k = String(o.kind || '').trim().toLowerCase();
  const kind = (CLASSIFY_KINDS as readonly string[]).includes(k) ? (k as ClassifyKind) : null;
  const route: InboxRoute | null = !kind || kind === 'other' ? null : kind === 'fiscal' ? 'fisk' : kind;
  return { kind, route, what: String(o.what || '').trim() };
}
