import { NextResponse, type NextRequest } from 'next/server';
import { FIRM_COOKIE } from '@/lib/context';

/**
 * „Излез (избор на фирма)“ / „⏏ ИЗЛЕЗ ОД ФИРМАТА“ (legacy `VIEWS.izlezF` 5513 → `chooseFirm`, `firmExit` 12904): leave the
 * current firm and show the firm picker (the dashboard without a firm is the legacy full-screen picker).
 */
export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/', req.url));
  res.cookies.delete(FIRM_COOKIE);
  return res;
}
