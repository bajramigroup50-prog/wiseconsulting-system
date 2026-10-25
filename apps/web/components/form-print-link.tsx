'use client';
/**
 * A print / PDF link of a report screen that takes the values typed in its filter form (`form` = the form's id) at the
 * moment of the click: dates changed without „Прикажи“ still print the chosen period (30.06, not 31.12). An unticked
 * checkbox drops its parameter; `only` limits the parameters taken from the form.
 */
export function FormPrintLink({ href, form, only, children, ...rest }: { href: string; form: string; only?: string[] } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const open = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const f = document.getElementById(form);
    if (!(f instanceof HTMLFormElement)) return;
    e.preventDefault();
    const u = new URL(href, window.location.origin);
    for (const el of Array.from(f.elements)) {
      const x = el as HTMLInputElement;
      if (!x.name || (only && !only.includes(x.name))) continue;
      if (x.type === 'checkbox') { if (x.checked) u.searchParams.set(x.name, x.value || '1'); else u.searchParams.delete(x.name); continue; }
      if (x.value) u.searchParams.set(x.name, x.value); else u.searchParams.delete(x.name);
    }
    window.open(u.pathname + u.search, '_blank', 'noopener');
  };
  return <a href={href} target="_blank" rel="noopener" onClick={open} {...rest}>{children}</a>;
}
