import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { firms, users } from '@wise/db';
import { ROLES } from '@wise/core';
import { requireUser } from '@/lib/auth';
import { currentFirm, currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { LawHome } from './zakoni/law-home';

export default async function Home() {
  const u = await requireUser();
  const [firm, year] = await Promise.all([currentFirm(u), currentYear()]);
  const [[fc], [uc]] = await Promise.all([
    db().select({ n: sql<number>`count(*)::int` }).from(firms),
    db().select({ n: sql<number>`count(*)::int` }).from(users),
  ]);
  return (
    <>
      <Hd t="Контролна табла" sub={`${firm?.name ?? 'нема избрана фирма'} · ${year}`} />
      <LawHome userId={u.id} role={u.role} />
      {!firm && (
        <div className="callout">Изберете фирма со <b>⇄ Промени фирма</b> горе, или отворете <Link href="/firmi">Фирми</Link>.</div>
      )}
      <div className="tiles">
        <div className="tile"><span className="k">Фирми</span><b className="v num">{fc?.n ?? 0}</b></div>
        <div className="tile"><span className="k">Корисници</span><b className="v num">{uc?.n ?? 0}</b></div>
        <div className="tile"><span className="k">Вашата улога</span><b className="v">{ROLES[u.role].n}</b></div>
      </div>
      <div className="card">
        <h2>Нова верзија во изградба</h2>
        <p className="note">
          Ова е новата инфраструктура (фаза 1: фирми, корисници и улоги, дневник на активности, складирање документи).
          Сметководствените модули се пренесуваат фаза по фаза од постоечката програма; ставките во менито што сè уште
          не се пренесени се означени како „во изработка“.
        </p>
      </div>
    </>
  );
}
