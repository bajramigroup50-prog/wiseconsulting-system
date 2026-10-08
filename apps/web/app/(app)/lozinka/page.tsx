import { requireUser } from '@/lib/auth';
import { Hd } from '@/components/hd';
import { MyPassword } from '../korisnici/my-password';

export default async function LozinkaPage() {
  const me = await requireUser();
  return (
    <>
      <Hd t="Промена на лозинка" sub={me.username} />
      <div className="card"><MyPassword /></div>
    </>
  );
}
