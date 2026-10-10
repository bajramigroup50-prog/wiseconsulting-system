'use client';
/** „← Назад / ⌂ Почеток“ above every screen except the dashboard, and Alt + ← (legacy `.navbk` / `navBack` 14660–14665). */
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function NavBack() {
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft' && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement | null)?.tagName ?? '')) { e.preventDefault(); router.back(); }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [router]);
  if (path === '/') return null;
  return (
    <div className="navbk" role="navigation" aria-label="Навигација">
      <button type="button" className="btn sm" title="Еден чекор назад (Alt + ←)" onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}>← Назад</button>
      <button type="button" className="btn sm" title="Кон почетната страница" onClick={() => router.push('/')}>⌂ Почеток</button>
    </div>
  );
}
