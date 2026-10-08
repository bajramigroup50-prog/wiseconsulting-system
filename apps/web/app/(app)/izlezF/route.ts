import { NextResponse, type NextRequest } from 'next/server';
import { FIRM_COOKIE } from '@/lib/context';

/** "Излез (избор на фирма)": leave the current firm and go back to the firm list. */
export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/firmi', req.url));
  res.cookies.delete(FIRM_COOKIE);
  return res;
}
