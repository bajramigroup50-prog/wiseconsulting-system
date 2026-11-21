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
import { tr, type Lang } from '@/lib/npo-i18n';

const dmy = (d: string) => d.split('-').reverse().join('.');
const todayDmy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' }).split('-').reverse().join('.');
/** `21.11.2026`, `21/11/2026`, `2026-11-21` → ISO, else null. */
function parse(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}

export function ConsentPill({ id, date, write, lang = 'mk' }: { id: string; date: string | null; write: boolean; lang?: Lang }) {
  const t = tr(lang);
  const router = useRouter();
  const [busy, start] = useTransition();
  const label = date ? `✓ ${dmy(date)}` : t('без согласност');
  if (!write) return <Link href={`/obroci?t=k&sog=${id}`} className={'pill' + (date ? ' good' : ' bad')}>{label}</Link>;
  function click() {
    const v = window.prompt(date ? t('Датум на согласноста (избришете го за „без согласност“):') : t('Потврди согласност – датум на потпишувањето:'), date ? dmy(date) : todayDmy());
    if (v == null) return;
    const iso = v.trim() ? parse(v) : null;
    if (v.trim() && !iso) { window.alert('Внесете датум како 21.11.2026.'); return; }
    if (!iso && !window.confirm(t('Да се тргне согласноста (без согласност)?'))) return;
    start(async () => {
      const r = await quickConsentAction(id, iso);
      if (r.error) window.alert(r.error);
      router.refresh();
    });
  }
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <button type="button" className={'pill' + (date ? ' good' : ' bad')} onClick={click} disabled={busy} style={{ cursor: 'pointer', border: 0 }}
        title={date ? t('Промени го датумот или тргни ја согласноста') : t('Клик – потврди согласност')}>{busy ? '…' : label}</button>
      {' '}<Link href={`/obroci?t=k&sog=${id}`} title={t('Образец (mk / sq) и скенирана согласност')} className="mini">📎</Link>
    </span>
  );
}

/** Header checkbox: tick / untick every row of the register for the bulk consent. */
export function SelAll({ form, lang = 'mk' }: { form: string; lang?: Lang }) {
  const t = tr(lang);
  return (
    <input type="checkbox" title={t('Сите')} aria-label={t('Означи ги сите')}
      onChange={(e) => { for (const x of Array.from(document.querySelectorAll<HTMLInputElement>(`input[name=sel][form=${form}]`))) x.checked = e.target.checked; }} />
  );
}
