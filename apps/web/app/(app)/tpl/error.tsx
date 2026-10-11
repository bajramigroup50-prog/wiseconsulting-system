'use client';
/**
 * Legacy `VIEWS.tpl` when `tplCfg()` fails (16136): „Поставките за шаблони не можеа да се вчитаат (мрежа). Ништо не е
 * променето.“ + „Обиди се повторно“. The error is recorded in „Регистар на грешки“ like on every screen.
 */
import { useEffect } from 'react';

export default function TplError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    fetch('/api/errors', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg: error.message, stack: error.stack, digest: error.digest, src: 'render', view: window.location.pathname }),
    }).catch(() => {});
  }, [error]);
  return (
    <div className="callout warn">
      Поставките за шаблони не можеа да се вчитаат (мрежа). Ништо не е променето.
      <div className="row" style={{ marginTop: 8 }}><button className="btn" type="button" onClick={() => retry()}>Обиди се повторно</button></div>
    </div>
  );
}
