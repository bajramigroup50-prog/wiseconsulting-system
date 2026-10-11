import { NextResponse, type NextRequest } from 'next/server';
import { PREVIEW_COOKIE } from '@/lib/route-guard';

/**
 * „✕ Излез од прегледот како клиент“ (legacy `VIEWS.klExit` 9064 / `klPrevOff` 9089): leave the office user's preview
 * of the client portal and go back to 👥 Портал за клиенти.
 */
export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/klPortal', req.url));
  res.cookies.delete(PREVIEW_COOKIE);
  return res;
}
