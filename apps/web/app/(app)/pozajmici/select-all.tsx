'use client';
/** „Означи сите / Тргни ги“ for the checkboxes of a form (legacy 16724). */
export function SelectAll({ name }: { name: string }) {
  const all = (on: boolean) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const f = e.currentTarget.closest('form');
    f?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((x) => { x.checked = on; });
  };
  return (
    <>
      <button type="button" className="btn sm" onClick={all(true)}>Означи сите</button>
      <button type="button" className="btn sm" onClick={all(false)}>Тргни ги</button>
    </>
  );
}
