import { ScreenExport } from './screen-export';

/**
 * Page header — legacy `title(t, sub, actions)`. Every screen gets „⬇ PDF“ / „⬇ Excel“ of what it shows
 * (`ScreenExport`); pass `exp={false}` where that makes no sense (forms only, no firm selected).
 */
export function Hd({ t, sub, children, exp = true }: { t: string; sub?: string; children?: React.ReactNode; exp?: boolean }) {
  return (
    <div className="hd">
      <h1>{t}{sub && <span className="mk">{sub}</span>}</h1>
      <div className="row">{children}{exp && <ScreenExport title={t} sub={sub} />}</div>
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
