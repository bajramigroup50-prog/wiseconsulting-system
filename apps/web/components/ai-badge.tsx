/**
 * „💲 AI“ — small badge on every button that spends AI credit (owner policy: AI only when nothing free can do it;
 * docs/AI-TROSHOK.md). Buttons whose read goes free-first (statements, trial balances, invoices with text) do not
 * carry it; buttons that always call the model do. For string labels (RowAction) use `AI_COST_TAG`.
 */
export const AI_COST_TAG = '💲 AI';
export const AI_COST_TITLE = 'Троши AI-кредит (Систем › 💲 AI трошок)';

export function AiBadge() {
  return (
    <span title={AI_COST_TITLE} aria-label={AI_COST_TITLE}
      style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '0 5px', borderRadius: 8, background: '#fef0c7', color: '#93370d', border: '1px solid #dc6803', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
      {AI_COST_TAG}
    </span>
  );
}
