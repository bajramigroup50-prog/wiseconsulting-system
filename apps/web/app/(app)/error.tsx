'use client';
/** Render error on a screen (legacy `render` wrapper 17466): logged in the error register, the user sees a message instead of a blank screen. */
import { useEffect } from 'react';
import { reportError } from '@/lib/report-error';

export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server errors carry a digest and are already stored by `instrumentation.ts` (with the real message).
    if (!error.digest) reportError(error.message, error.stack, 'render');
  }, [error]);
  return (
    <div className="callout warn">
      ⚠ Се појави грешка на овој екран – запишана е во „Регистар на грешки“. Пробајте повторно или изберете друг екран.{' '}
      <button type="button" className="btn sm" onClick={() => reset()}>↻ Пробај повторно</button>
    </div>
  );
}
