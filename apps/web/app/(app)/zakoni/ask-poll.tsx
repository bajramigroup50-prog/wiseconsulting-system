'use client';
/** Refresh the page while the user's question to the law assistant is being answered. */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AskPoll({ pending }: { pending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [pending, router]);
  return null;
}
