'use client';
/**
 * Small client helpers of the hotel and rent-a-car screens (legacy `onchange` handlers of `VIEWS.hotel` / `rcEditor`):
 * - {@link DateJump}: the grid start date (`#ht_from`, `#rc_from`) — navigates on change;
 * - {@link PrefillSelect}: room / vehicle select that fills the dependent fields of a new document (legacy: room
 *   change → price and beds, vehicle change → deposit and km at the handover);
 * - {@link ItemPick}: room-charge article (legacy `#hc_it` change → gross price and VAT rate of the article).
 */
import { useRouter } from 'next/navigation';

export function DateJump({ base, value, param = 'from', extra = {} }: { base: string; value: string; param?: string; extra?: Record<string, string> }) {
  const router = useRouter();
  return (
    <input type="date" defaultValue={value} style={{ width: 'auto' }}
      onChange={(e) => { if (e.target.value) router.push(`${base}?${new URLSearchParams({ ...extra, [param]: e.target.value }).toString()}`); }} />
  );
}

type Form = HTMLFormElement & { elements: HTMLFormControlsCollection };
const setField = (f: Form | null, k: string, v: string | number | null | undefined) => {
  const el = f?.elements.namedItem(k);
  if (el && 'value' in el && v != null) (el as unknown as HTMLInputElement).value = String(v);
};

export function PrefillSelect({ name, defaultValue, options, apply, disabled }: {
  name: string; defaultValue: string; apply: boolean; disabled?: boolean;
  options: { value: string; label: string; set?: Record<string, string | number | null> }[];
}) {
  return (
    <select name={name} defaultValue={defaultValue} disabled={disabled}
      onChange={(e) => {
        if (!apply) return;
        const o = options.find((x) => x.value === e.target.value);
        for (const [k, v] of Object.entries(o?.set ?? {})) setField(e.target.form as Form, k, v);
      }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function ItemPick({ items }: { items: { id: string; name: string; gross: number; rate: number }[] }) {
  return (
    <>
      <input name="cname" list="hc_l" placeholder="избери или впиши" style={{ width: 240 }}
        onChange={(e) => {
          const f = e.target.form as Form;
          const x = items.find((i) => i.name === e.target.value);
          setField(f, 'citem', x?.id ?? '');
          if (x) { setField(f, 'cprice', x.gross); setField(f, 'crate', String([18, 10, 5].includes(x.rate) ? x.rate : 18)); }
        }} />
      <input type="hidden" name="citem" defaultValue="" />
      <datalist id="hc_l">{items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
    </>
  );
}
