import Link from 'next/link';
import { Hd } from './hd';

/** Shown by firm-scoped pages when no firm is selected. */
export function NoFirm({ t }: { t: string }) {
  return (
    <>
      <Hd t={t} />
      <div className="callout">Изберете фирма со <b>⇄ Промени фирма</b> горе, или отворете <Link href="/firmi">Фирми</Link>.</div>
    </>
  );
}
