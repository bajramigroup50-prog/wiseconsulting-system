'use client';
/**
 * „Изберете година“ — the first screen after the login (then the firm list of that year): the working year is chosen
 * deliberately, never left from an earlier session or changed by an accidental select. Default: the calendar year.
 */
import { noteRendered } from '@/components/firm-guard';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { setYear } from '@/app/(app)/actions';
import { logout } from '@/app/login/actions';

export function YearPicker({ year, calendar, minYear, chosen, user }: {
  /** Working year now (the cookie, or the calendar year when none was chosen yet). */
  year: number; calendar: number; minYear?: number | null;
  /** A year was already chosen in this session (shown as current; else the calendar year is preselected). */
  chosen: boolean; user: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const y0 = Math.min(2012, calendar - 10, minYear ?? calendar);
  const years = Array.from({ length: calendar + 2 - y0 }, (_, i) => calendar + 1 - i);
  const sel = chosen ? year : calendar;
  const pick = (y: number) => start(async () => { await setYear(y); noteRendered({ year: y }); router.push('/'); router.refresh(); });

  useEffect(() => {
    document.body.classList.add('picking');
    return () => document.body.classList.remove('picking');
  }, []);

  return (
    <div className="fp2" id="yearPicker">
      <div className="fp2-top">
        <h1>Изберете година <span className="note" style={{ fontSize: 14, fontWeight: 400 }}>· сите внесови одат во избраната година</span></h1>
        <form action={logout} style={{ display: 'inline' }}><button className="btn">Одјава ({user})</button></form>
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'center', margin: '10px 0 16px', flexWrap: 'wrap' }}>
        <button type="button" className="btn pri" autoFocus disabled={pending} onClick={() => pick(sel)} style={{ fontSize: 18, padding: '10px 22px' }}>
          Продолжи во {sel}{sel === calendar ? ' (тековна година)' : ''} →
        </button>
        {pending && <span className="note">Се отвора…</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="list" aria-label="Години">
        {years.map((y) => (
          <button key={y} type="button" role="listitem" disabled={pending} onClick={() => pick(y)}
            className={'btn' + (y === sel ? ' pri' : '')} style={{ minWidth: 92, fontSize: 16, fontWeight: y === calendar ? 700 : 400 }}
            title={y === calendar ? 'Тековна година' : y > calendar ? 'Идна година' : ''}>
            {y}{y === calendar ? ' ★' : ''}
          </button>
        ))}
      </div>
      <p className="note" style={{ marginTop: 12 }}>★ тековна календарска година. Ако работите во друга година, на секој екран стои предупредување.</p>
    </div>
  );
}
