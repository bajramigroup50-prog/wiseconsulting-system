'use client';
/**
 * МК / SQ switch of the НПО screens: the choice is kept in the cookie `wise-lang` (one year) and the screen is
 * redrawn. The resolved language is also written on the first visit, so the server actions answer in it.
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const set = (l: string) => { document.cookie = `wise-lang=${l}; path=/; max-age=31536000; samesite=lax`; };

export function LangSwitch({ lang }: { lang: 'mk' | 'sq' }) {
  const router = useRouter();
  useEffect(() => { if (!/(^|; )wise-lang=/.test(document.cookie)) set(lang); }, [lang]);
  const pick = (l: 'mk' | 'sq') => { if (l === lang) return; set(l); router.refresh(); };
  return (
    <span className="row noprint" style={{ gap: 2 }} role="group" aria-label="Јазик / Gjuha">
      <button type="button" className={'btn sm' + (lang === 'mk' ? ' pri' : '')} aria-pressed={lang === 'mk'} onClick={() => pick('mk')}>МК</button>
      <button type="button" className={'btn sm' + (lang === 'sq' ? ' pri' : '')} aria-pressed={lang === 'sq'} onClick={() => pick('sq')}>SQ</button>
    </span>
  );
}
