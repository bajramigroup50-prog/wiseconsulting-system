/**
 * „📦 Пакет на патувањето“: ONE PDF (or photo) of a transport client holding the whole trip — the transport invoice,
 * the CMR, the travel order (патен налог) and the road receipts (fuel, tolls…). The model groups the pages by kind;
 * `bundleGroups` validates the groups (contiguous, covering 1..n) and joins neighbours of the same kind (a 2-page
 * travel order, several receipt pages) — invoices with different numbers stay apart (each is its own document).
 */
export type BundleKind = 'invoice' | 'cmr' | 'travel' | 'receipt' | 'other';
export const BUNDLE_KINDS: readonly BundleKind[] = ['invoice', 'cmr', 'travel', 'receipt', 'other'];
export const BUNDLE_LABEL: Record<BundleKind, string> = { invoice: '🧾 Фактура', cmr: '📄 CMR', travel: '🚛 Патен налог', receipt: '⛽ Сметки', other: '📎 Друго' };

export const TRIP_BUNDLE_PROMPT = (n: number) => `This document${n > 1 ? ` has ${n} pages and` : ''} comes from a Macedonian road transport company: the papers of ONE or more truck trips scanned together. Classify the pages by kind and group them. Kinds:
"invoice" = the transport company's INVOICE (фактура) to its customer for the transport (number, buyer, amount, VAT / "member 32-a" / international transport 0%);
"cmr" = CMR consignment note (international waybill, boxes 1–24, sender / consignee / carrier, stamps) or a domestic товарен лист;
"travel" = travel order (патен налог / налог за службено патување) of the driver, with its border-crossing records, trip report, per-diem calculation;
"receipt" = fiscal receipts / bills paid on the road in ANY country (fuel, tolls, vignettes, parking, ferry, tunnel, hotel, restaurant, truck wash, service);
"other" = anything else (delivery notes, orders, weighing notes, photos…).
Reply with ONLY JSON: {"groups":[{"from":1,"to":1,"kind":"invoice"|"cmr"|"travel"|"receipt"|"other","number":"document number or empty"}]} covering every page 1..${n} in order without gaps. Consecutive pages of the same document go together (an invoice continued on page 2, a 2-page travel order). Several receipts on one page or on consecutive pages may be one group.`;

export interface BundleGroup { from: number; to: number; kind: BundleKind; number: string }

export function bundleGroups(raw: unknown, n: number): BundleGroup[] | null {
  const G = ((((raw as { groups?: unknown[] } | null)?.groups) ?? []) as { from?: unknown; to?: unknown; kind?: unknown; number?: unknown }[])
    .map((g) => ({ from: Number(g.from), to: Number(g.to), kind: (BUNDLE_KINDS.includes(g.kind as BundleKind) ? g.kind : 'other') as BundleKind, number: String(g.number ?? '').trim() }))
    .filter((g) => Number.isInteger(g.from) && Number.isInteger(g.to) && g.from >= 1 && g.to >= g.from && g.to <= n)
    .sort((a, b) => a.from - b.from);
  if (!G.length || G[0]!.from !== 1 || G[G.length - 1]!.to !== n) return null;
  for (let i = 1; i < G.length; i++) if (G[i]!.from !== G[i - 1]!.to + 1) return null;
  const out: BundleGroup[] = [];
  for (const g of G) {
    const p = out[out.length - 1];
    const same = p && p.kind === g.kind && (g.kind !== 'invoice' || !g.number || !p.number || g.number === p.number);
    if (same) { p.to = g.to; if (!p.number) p.number = g.number; continue; }
    out.push({ ...g });
  }
  return out;
}
