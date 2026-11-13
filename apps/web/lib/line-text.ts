/** Shared (client + server): the text of a ledger line. */
/** Text of a card row (legacy `kcSod` / label + note). */
export const lineText = (l: { description?: string | null; doc?: string | null; note?: string | null }) => {
  // a nalog imported from the old program: the line's own name (document / text), not „Увезен налог 6/1-3“
  const imp = /^Увезен налог/i.test(l.description ?? '') && (l.doc || l.note);
  if (imp) {
    // a bank statement line of the old program („IZVOD BR 58“) → „Извод бр. 58 · Ф-ра 15/26“
    const iz = /(?:izvod|извод|izv\.?|изв\.?)\s*(?:br\.?|бр\.?|no\.?)?\s*(\d+)/i.exec(`${l.note ?? ''} ${l.doc ?? ''}`);
    if (iz) return `Извод бр. ${iz[1]}${l.doc && !/(?:izvod|извод)/i.test(l.doc) && !/^\d{1,2}[-/.]\d{4}$/.test(l.doc) ? ` · Ф-ра ${l.doc}` : ''}`;
  }
  const desc = imp ? '' : l.description;
  return [desc, l.doc && !(desc ?? '').includes(l.doc) ? l.doc : '', l.note && l.note !== l.doc ? l.note : ''].filter(Boolean).join(' · ');
};
