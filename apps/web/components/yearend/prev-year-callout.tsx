/**
 * Callout for a selected year whose previous year has postings but was not closed / carried over — instead of
 * silently empty data (dashboard, „Пренос на салда“, „Почетна состојба“). Server component; the buttons are the
 * client `YearGo` (year switch + navigate, primitives only).
 */
import { prevYearCarry } from '@wise/db';
import { db } from '@/lib/db';
import { YearGo } from './year-go';

export async function PrevYearCallout({ firmId, year }: { firmId: string; year: number }) {
  const s = await prevYearCarry(db(), firmId, year);
  if (!s.prevHasData || s.opened) return null;
  const P = year - 1;
  if (!s.prevClosed) {
    return (
      <div className="callout bad" id="prevYearCallout">
        ⚠ <b>Годината {P} не е затворена – затворете ја и пренесете ги салдата.</b>{' '}
        Почетната состојба за {year} е празна додека {P} не се затвори: Завршна сметка → Затворање на годината {P} (салдата се пренесуваат во
        „Почетна состојба {year}“ во истата акција).{' '}
        <YearGo year={P} to="/mbyllja">Затворање на {P} →</YearGo> <YearGo year={P} to="/prenos">Пренос на салда →</YearGo>
      </div>
    );
  }
  return (
    <div className="callout warn" id="prevYearCallout">
      ⚠ <b>Годината {P} е затворена, но салдата не се пренесени во {year}.</b>{' '}
      <YearGo year={P} to="/prenos">Пренеси ги салдата од {P} →</YearGo>
    </div>
  );
}
