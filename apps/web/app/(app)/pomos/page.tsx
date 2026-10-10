/**
 * Legacy `VIEWS.pomos` 5514 — Помош › Упатство (short manual). Same seven steps as legacy, each linked to the screen;
 * plus the server-specific notes (roles, documents in the archive, backups) that replace the single-file program's
 * browser storage.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { viewAllowed } from '@/lib/nav';
import { Hd } from '@/components/hd';

const STEPS: [string, string, React.ReactNode][] = [
  ['Фирми', '/firmi', <>изберете или регистрирајте фирма; „Промени фирма“ / „Излез“ враќа на изборот.</>],
  ['Материјално → Влез', '/vlez', <>повлечете ја фактурата од добавувачот (PDF/слика); програмот ја чита, ја креира калкулацијата и налогот (6600 / 13005 / 130010 / 130018 / 2200). Проверете и „Зачувај и прокнижи“.</>],
  ['Материјално → Излез / Услуги', '/izlez', <>излезни фактури; стоката автоматски се раздолжува од магацинот. Бришење со 🗑, корекција со „Измени“ или „Одобрение“.</>],
  ['Пренос во продавница', '/prenosi', <>кај влезната фактура „→ Продавница“ или Материјално → Други документи → Пренос; се внесуваат малопродажните цени (%), се печати Преносница и ПЛТ.</>],
  ['Малопродажба', '/m_trg', <>влезни калкулации на продавницата, МЕТГ, КДФИ, нивелации и каса.</>],
  ['Финансово', '/nalozi', <>изводи, благајна, налози (2/1-3, 6/1-3…), картици по комитент, ДДВ-04, плати и завршна сметка.</>],
  ['Шифрарник', '/sifrarnik', <>комитенти, артикли, контен план, магацини и продавници.</>],
];

export default async function PomosPage() {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'pomos')) notFound();
  return (
    <>
      <Hd t="Помош" sub="кратко упатство" />
      <div className="card">
        <ol style={{ lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
          {STEPS.map(([t, href, d]) => <li key={t}><b><Link href={href}>{t}</Link></b> – {d}</li>)}
        </ol>
      </div>
      <div className="card">
        <h2>Во новата верзија (на сервер)</h2>
        <ul style={{ lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
          <li>Сите податоци се чуваат на серверот на канцеларијата – не во прелистувачот. Секој колега се најавува со своето корисничко име; правата ги доделува администраторот во <Link href="/korisnici">Корисници и улоги</Link>.</li>
          <li>Скенираните и прикачените документи се во <Link href="/arhiva">Архива на документи</Link>; нов документ во досието на фирмата: <Link href="/arNewNav">📷 Скенирај / прикачи нов документ</Link>.</li>
          <li>Секоја измена се запишува во <Link href="/aktivnost">Дневник на активности</Link> (кој, што и кога).</li>
          <li>Резервна копија на целата база и документите се прави автоматски секоја ноќ; извоз на податоците на една фирма: <Link href="/sistem">Податоци и резервна копија</Link>.</li>
          <li>Шифрарниците (магацини, продавници, благајни, работни места, шифри за плата…) се во <Link href="/sifrarnik">Сите шифрарници</Link>.</li>
        </ul>
      </div>
    </>
  );
}
