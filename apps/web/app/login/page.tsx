import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  if (await getUser()) redirect('/');
  return (
    <div className="app">
      <main>
        <div className="sheet">
          <div className="picker">
            <div className="pk-head">
              <div className="brand big"><i aria-hidden="true">W</i>WISE CONSULTING</div>
              <h1>Најава</h1>
              <p className="note">Внесете корисничко име и лозинка.</p>
            </div>
            <LoginForm />
          </div>
        </div>
      </main>
    </div>
  );
}
