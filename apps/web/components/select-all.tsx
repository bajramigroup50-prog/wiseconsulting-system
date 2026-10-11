'use client';
/** Header checkbox that ticks every `name` checkbox of its form (legacy `#slAll` „Избери ги сите“). */
export function SelectAll({ name = 'ids' }: { name?: string }) {
  return <input type="checkbox" title="Избери ги сите" onChange={(e) => {
    e.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((x) => { x.checked = e.currentTarget.checked; });
  }} />;
}
