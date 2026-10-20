'use client';
/**
 * ⏳ inside a `<Link>` while its page is loading: a filter chip that takes a second or two (the dashboard period)
 * otherwise looked as if the click did nothing.
 */
import { useLinkStatus } from 'next/link';

export function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <span aria-hidden="true"> ⏳</span> : null;
}
