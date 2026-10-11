'use client';
/** Legacy 16456 `#ddvPerKind`: month / quarter switch that asks first and drops the selected period. */
import { useRef } from 'react';

export function PeriodKind({ kind, firmName, write, action }: { kind: 'month' | 'quarter'; firmName: string; write: boolean; action: (form: FormData) => Promise<void> }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={action} className="row" style={{ gap: 4 }}>
      <select name="vatPeriod" defaultValue={kind} style={{ width: 'auto' }} disabled={!write} title="Даночен период на фирмата (над 25 мил. ден. промет = месечен)"
        onChange={(e) => {
          const v = e.target.value;
          if (!window.confirm(`Даночниот период на ${firmName} да се смени во ${v === 'month' ? 'МЕСЕЧЕН' : 'ТРИМЕСЕЧЕН'}?\n\n(Месечен е задолжителен кога прометот во претходната година е над 25.000.000 ден.)`)) { e.target.value = kind; return; }
          ref.current?.requestSubmit();
        }}>
        <option value="quarter">Тримесечно</option><option value="month">Месечно</option>
      </select>
    </form>
  );
}
