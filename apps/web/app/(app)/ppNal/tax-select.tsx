'use client';
/**
 * „Готов образец за данок“ in the ПП50 editor (legacy `data-pptax` listener 15821): applies the template's payment
 * account, revenue code, reference and purpose to the open form; the amount only when it is still empty.
 */
export interface PpTaxTpl { key: string; name: string; uplSm: string; prihod: string; refDebit: string; purpose: string; amount: string }

export function PpTaxSelect({ templates, value }: { templates: PpTaxTpl[]; value: string }) {
  return (
    <label className="f wide">Готов образец за данок
      <select name="taxKey" defaultValue={value} onChange={(e) => {
        const t = templates.find((x) => x.key === e.target.value);
        const F = e.target.form;
        if (!t || !F) return;
        const set = (k: string, v: string, onlyEmpty = false) => {
          const el = F.elements.namedItem(k) as HTMLInputElement | HTMLTextAreaElement | null;
          if (el && (!onlyEmpty || !el.value.trim())) el.value = v;
        };
        set('uplSm', t.uplSm); set('prihod', t.prihod); set('refDebit', t.refDebit); set('purpose', t.purpose); set('amount', t.amount, true);
      }}>
        <option value="">— избери —</option>
        {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
      </select>
    </label>
  );
}
