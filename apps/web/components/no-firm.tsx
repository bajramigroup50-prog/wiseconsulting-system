import { canSee } from '@/lib/can-see';
import Link from 'next/link';
import { Hd } from './hd';

/** Shown by firm-scoped pages when no firm is selected. */
export async function NoFirm({ t }: { t: string }) {
  return (
    <>
      <Hd t={t} exp={false} />
      <div className="callout">Изберете фирма со <b>⇄ Промени фирма</b> горе, или отворете {(await canSee('firmi')) ? <Link href="/firmi">Фирми</Link> : '„⏏ Излез од фирмата“'}.</div>
    </>
  );
}
