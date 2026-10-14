/**
 * „📷 Испрати документ“ — the client's phone capture (`/klFoto`): what kind of document the client says it is, which
 * office route that suggests in „📥 Пристигнато од клиенти“, and the status the client sees in their history.
 * Pure (no DB): shared by the capture page, the server action, the office inbox and the worker's photo → PDF job.
 */
import type { InboxRoute } from './portal';

/** Document kinds the client picks on the phone, with the office route they suggest (one-click „→ …“ in the inbox). */
export const CAPTURE_KINDS = {
  in: { label: 'Влезна фактура', icon: '📥', route: 'purchase' },
  out: { label: 'Излезна фактура', icon: '🧾', route: 'sale' },
  bank: { label: 'Извод', icon: '🏦', route: 'bank' },
  fisk: { label: 'Фискална сметка', icon: '🧾', route: 'fisk' },
  contract: { label: 'Договор', icon: '✍', route: 'dossier', category: 'Договори (закуп, соработка, кредит)' },
  other: { label: 'Друго', icon: '📄', route: 'dossier', category: 'Друго од клиентот' },
} as const satisfies Record<string, { label: string; icon: string; route: InboxRoute; category?: string }>;
export type CaptureKind = keyof typeof CAPTURE_KINDS;
export const isCaptureKind = (k: unknown): k is CaptureKind => typeof k === 'string' && Object.hasOwn(CAPTURE_KINDS, k);

/** The suggested route (and dossier category) for a message the client sent with a kind; null without a kind. */
export function captureRoute(kind: string | null | undefined): { route: InboxRoute; category: string | null } | null {
  if (!isCaptureKind(kind)) return null;
  const k = CAPTURE_KINDS[kind] as { route: InboxRoute; category?: string };
  return { route: k.route, category: k.category ?? null };
}

/** Subject of the inbox message (the office sees it in bold): „📷 Влезна фактура (3 стр.)“. */
export function captureSubject(kind: CaptureKind, pages: number): string {
  return `📷 ${CAPTURE_KINDS[kind].label}${pages > 1 ? ` (${pages} стр.)` : ''}`;
}

/** Client-side image compression target (long side in px, JPEG quality). */
export const CAPTURE_MAX_PX = 2000;
export const CAPTURE_JPEG_Q = 0.8;
/** At most this many photos / files in one send. */
export const CAPTURE_MAX_FILES = 30;

/** Scale factor so the long side is at most `max` px (never upscales). */
export const captureScale = (w: number, h: number, max = CAPTURE_MAX_PX): number => (w > 0 && h > 0 ? Math.min(1, max / Math.max(w, h)) : 1);

/** Status the client sees for a message they sent: примено (in the office inbox) → обработено (the office routed / closed it). */
export type CaptureStatus = 'received' | 'processed';
export const CAPTURE_STATUS: Record<CaptureStatus, string> = { received: 'примено', processed: 'обработено' };
export const captureStatus = (i: { done: boolean }): CaptureStatus => (i.done ? 'processed' : 'received');

/** File name of the PDF the worker makes from several photos: „Vlezna_faktura_2026-10-14.pdf“. */
export function capturePdfName(kind: string | null | undefined, date: string): string {
  const L: Record<string, string> = { in: 'Vlezna_faktura', out: 'Izlezna_faktura', bank: 'Izvod', fisk: 'Fiskalna_smetka', contract: 'Dogovor', other: 'Dokument' };
  return `${L[kind ?? ''] ?? 'Dokument'}_${date}.pdf`;
}

/** Inbox job (worker): combine the photos of one message into a single PDF (pdf-lib). */
export const INBOX_COMBINE_JOB = 'inbox.combine';
