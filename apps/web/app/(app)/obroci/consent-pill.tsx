'use client';
/**
 * The „Согласност“ cell of the register: a click on the red „без согласност“ asks for the date (today by default)
 * and saves it; a click on the green „✓ дд.мм.гггг“ changes the date or (empty) removes the consent. 📎 opens the
 * printable form and the scan upload. Without write rights it only links to the form.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { quickConsentAction } from './actions';

const dmy = (d: string) => d.split('-').reverse().join('.');
const todayDmy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' }).split('-').reverse().join('.');
/** `21.11.2026`, `21/11/2026`, `2026-11-21` → ISO, else null. */
function parse(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}

export function ConsentPill({ id, date, write }: { id: string; date: string | null; write: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const label = date ? `✓ ${dmy(date)}` : 'без согласност';
  if (!write) return <Link href={`/obroci?t=k&sog=${id}`} className={'pill' + (date ? ' good' : ' bad')}>{label}</Link>;
  function click() {
    const v = window.prompt(date ? 'Датум на согласноста (избришете го за „без согласност“):' : 'Потврди согласност – датум на потпишувањето:', date ? dmy(date) : todayDmy());
    if (v == null) return;
    const iso = v.trim() ? parse(v) : null;
    if (v.trim() && !iso) { window.alert('Внесете датум како 21.11.2026.'); return; }
    if (!iso && !window.confirm('Да се тргне согласноста (без согласност)?')) return;
    start(async () => {
      const r = await quickConsentAction(id, iso);
      if (r.error) window.alert(r.error);
      router.refresh();
    });
  }
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <button type="button" className={'pill' + (date ? ' good' : ' bad')} onClick={click} disabled={busy} style={{ cursor: 'pointer', border: 0 }}
        title={date ? 'Промени го датумот или тргни ја согласноста' : 'Клик – потврди согласност'}>{busy ? '…' : label}</button>
      {' '}<Link href={`/obroci?t=k&sog=${id}`} title="Образец (mk / sq) и скенирана согласност" className="mini">📎</Link>
    </span>
  );
}

/** Header checkbox: tick / untick every row of the register for the bulk consent. */
export function SelAll({ form }: { form: string }) {
  return (
    <input type="checkbox" title="Сите" aria-label="Означи ги сите"
      onChange={(e) => { for (const x of Array.from(document.querySelectorAll<HTMLInputElement>(`input[name=sel][form=${form}]`))) x.checked = e.target.checked; }} />
  );
}
