'use client';
/**
 * „Шема за книжење: [Шема 1 ▾]“ in the header of a posted document (Дополнителни). Empty value = by the rules: the
 * partner card's default, else Шема 1 (resolved when the document is saved, `@wise/db` `docSchemeData`).
 */
export interface SchemeOpt { no: number; label: string }

export function SchemeSelect({ value, onChange, schemes, partnerDefault, disabled }: {
  value: string; onChange: (v: string) => void; schemes: readonly SchemeOpt[]; partnerDefault?: number; disabled?: boolean;
}) {
  if (!schemes.length) return null;
  const auto = partnerDefault && partnerDefault > 1 ? schemes.find((s) => s.no === partnerDefault)?.label ?? `Шема ${partnerDefault}` : 'Шема 1 – основна';
  return (
    <label className="fl" title="Со која шема на книжење се книжи документот. Шемите се во Шифрарник → Шеми на книжење; комитентот може да има своја стандардна шема.">
      <span>Шема за книжење</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} data-testid="doc-scheme">
        <option value="">Автоматски – {auto}{partnerDefault && partnerDefault > 1 ? ' (според комитентот)' : ''}</option>
        <option value="1">Шема 1 – основна</option>
        {schemes.map((s) => <option key={s.no} value={String(s.no)}>{s.label}</option>)}
      </select>
    </label>
  );
}
