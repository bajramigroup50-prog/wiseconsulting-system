/** Year-end phase bar (legacy `ZS_PH` 11157, `ZS_SUBN` 11168, `zsPhBar` 11171) + page header (`zsHead` 7640). */
import Link from 'next/link';
import type { YeEntity } from '@wise/core';
import { Hd } from '@/components/hd';
import { GoButton } from './go-button';

/** Statement / return screens per entity (legacy `ENT_V` applied to the phase bar). */
const STATEMENTS: Record<YeEntity, string[]> = {
  co: ['zs_bs', 'zs_bu', 'zs_de', 'zs_sp', 'zs_skr'],
  tp: ['zs_bs', 'zs_bu', 'zs_de', 'zs_sp', 'zsTP'],
  sd: ['zsTP'],
  npo: ['zsNPO'],
};

const phases = (ent: YeEntity): [string, string, string[]][] => [
  ['zsProc', 'Преглед', ['zsProc']],
  ['zsKontrola', '1. Контрола', ['zsKontrola']],
  ...(ent === 'co' ? [['zs_db', '2. Даночен биланс', ['zs_db', 'zs_vp']] as [string, string, string[]]] : []),
  ['mbyllja', '3. Затворање', ['mbyllja']],
  ['stm', '4. Биланси и обрасци', STATEMENTS[ent]],
  ['zsBel', '5. Белешки', ['zsBel']],
  ['zsXml', '6. XML и поднесување', ['zsXml']],
  ['zsDos', '7. Досие', ['zsDos']],
  ['prenos', '8. Нова година', ['prenos']],
  ...(ent === 'co' || ent === 'tp' ? [['zs_aop', '⚙ Алатки', ['zs_aop', 'zs_pr', 'zsRok']] as [string, string, string[]]] : [['zsRok', '⚙ Алатки', ['zsRok']] as [string, string, string[]]]),
];

const SUBN: Record<string, string> = {
  zs_db: 'ДБ (данок на добивка)', zs_vp: 'ДБ-ВП (данок на вкупен приход)', zs_bs: 'Биланс на состојба', zs_bu: 'Биланс на успех',
  zs_de: 'Образец 38 – државна евиденција', zs_sp: 'Образец 35 – приходи по дејности', zsTP: 'Образец Б и ДЛД-ДБ', zsNPO: 'Годишна сметка – НПО',
  zs_skr: 'Скратен биланс на успех', zs_aop: 'АОП', zs_pr: 'Правила за завршна пресметка', zsRok: 'Што, каде и кога',
};

export function PhBar({ cur, ent, done }: { cur: string; ent: YeEntity; done: Record<string, boolean> }) {
  const P = phases(ent);
  const ph = P.find((p) => p[2].includes(cur)) ?? P[0]!;
  const subs = ph[2];
  return (
    <>
      <div className="ftabs zs-tabs" style={{ marginBottom: subs.length > 1 ? 2 : 14 }}>
        {P.map((p) => (
          <GoButton key={p[0]} href={`/${p === ph ? cur : p[2][0]}`} selected={p === ph}>
            {p[1]}{done[p[0]] && <span style={{ color: 'var(--good)' }}> ✓</span>}
          </GoButton>
        ))}
      </div>
      {subs.length > 1 && (
        <div className="row zs-sub" style={{ gap: 6, flexWrap: 'wrap', margin: '6px 0 14px' }}>
          {subs.map((v) => <Link key={v} className={`btn sm ${v === cur ? 'pri' : ''}`} href={`/${v}`}>{SUBN[v] ?? v}</Link>)}
        </div>
      )}
    </>
  );
}

/** Legacy `zsHead(id, t, btns)`: title "завршна пресметка <Y>" + phase bar. */
export function ZsHead({ id, t, year, ent, done, children }: {
  id: string; t: string; year: number; ent: YeEntity; done: Record<string, boolean>; children?: React.ReactNode;
}) {
  return (
    <>
      <Hd t={t} sub={`завршна пресметка ${year}`}>{children}</Hd>
      <PhBar cur={id} ent={ent} done={done} />
    </>
  );
}

/** Legacy `zsYearsNote`. */
export function NotClosedNote({ closed, year }: { closed: boolean; year: number }) {
  if (closed) return null;
  return (
    <div className="callout warn">
      Годината {year} сè уште не е затворена — износите се прелиминарни (данокот на добивка е пресметан од ДБ). <Link className="btn sm" href="/mbyllja">Затворање на година</Link>
    </div>
  );
}
