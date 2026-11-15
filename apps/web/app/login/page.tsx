import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { LoginForm } from './login-form';
import { brandLetter, brandName, brandSite } from '@wise/core';
import './login.css';

/**
 * Најава (design „Б“): dark green, the brand letter large, today's date, the form on a light card; МК / SQ labels,
 * 👁 show password, remembered user name (this browser only — never the password). The sign-in itself, the 2FA step,
 * the lock after failed tries and the session limits are unchanged (`actions.ts`, `lib/login-guard.ts`).
 */
export default async function LoginPage() {
  if (await getUser()) redirect('/');
  return (
    <div className="lg-wrap">
      <div className="lg-top">
        <div className="lg-letter" aria-hidden="true">{brandLetter()}</div>
        <div className="lg-name">{brandName()}</div>
      </div>
      <LoginForm brand={brandName()} mail={`info@${brandSite()}`} />
    </div>
  );
}
