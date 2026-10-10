'use client';
/**
 * Error boundary of the app screens (legacy `render` wrapper 17468): the error is recorded in „Регистар на грешки“
 * (`/api/errors`) and the user sees a message instead of an empty screen.
 */
import { useEffect } from 'react';

export default function ScreenError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    fetch('/api/errors', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg: error.message, stack: error.stack, digest: error.digest, src: 'render', view: window.location.pathname }),
    }).catch(() => {});
  }, [error]);
  return (
    <div className="callout warn">
      ⚠ Се појави грешка на овој екран – запишана е во „Регистар на грешки“. Пробајте повторно или изберете друг екран.
      <div className="row" style={{ marginTop: 8 }}><button className="btn" type="button" onClick={() => retry()}>Пробај повторно</button></div>
    </div>
  );
}
