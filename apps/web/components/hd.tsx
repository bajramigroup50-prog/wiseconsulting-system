/** Page header — legacy `title(t, sub, actions)`. */
export function Hd({ t, sub, children }: { t: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="hd">
      <h1>{t}{sub && <span className="mk">{sub}</span>}</h1>
      <div className="row">{children}</div>
    </div>
  );
}

export const dmy = (d: string | Date | null | undefined): string => {
  if (!d) return '—';
  const s = typeof d === 'string' ? d : d.toISOString();
  return s.slice(0, 10).split('-').reverse().join('.');
};

export const dmyHm = (d: Date | null | undefined): string =>
  d ? `${dmy(d)} ${d.toLocaleTimeString('mk-MK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Skopje' })}` : '—';
