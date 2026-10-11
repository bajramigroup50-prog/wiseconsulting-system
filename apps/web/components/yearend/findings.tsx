/** Phase-gate findings card (legacy `zcHTML` 11223 + wrapper 17092, ACT `zcAck`/`zcUnack`). */
import Link from 'next/link';
import type { ZcFinding } from '@wise/core';
import { dmy } from '@/lib/fmt';
import { RowAction } from '@/components/row-action';
import { ackFinding, unackFinding } from '@/app/(app)/zsProc/actions';
import { ActionForm } from './action-form';

/** Legacy view ids → routes that exist in the rebuild (others stay plain text until their phase lands). */
const goHref = (x: ZcFinding): string | null => {
  if (!x.go) return null;
  if (x.go === 'kkart' && x.goSt?.kkK) return `/kkart?k=${x.goSt.kkK}`;
  // Legacy `zcGo` 11228: the partner card opens on that partner.
  if (x.go === 'kartici' && x.goSt?.pid) return `/kartici?pid=${encodeURIComponent(x.goSt.pid)}`;
  return `/${x.go}`;
};

export function FindingsCard({ all, open, ack, canAck, canDist }: {
  all: readonly ZcFinding[];
  open: readonly ZcFinding[];
  ack: Record<string, { note?: string; by?: string; at?: string }>;
  canAck: boolean;
  /** Legacy 17093 „⇄ Распредели по партнери“ on np12 / np22 (needs `fix`). */
  canDist?: boolean;
}) {
  return (
    <div className="card" style={{ borderColor: open.length ? 'var(--bad)' : 'var(--good)' }}>
      <div className="hd">
        <h2 style={{ fontSize: 15, margin: 0 }}>0. Документи и салда</h2>
        {open.length ? <span className="pill bad">{open.length} за средување</span> : <span className="pill good">✓</span>}
      </div>
      <p className="mini" style={{ margin: '0 0 6px' }}>
        {open.length
          ? <b>Додека овие не се средени, програмата не дозволува затворање на годината, пренос во новата година, заклучување и XML за ЦРМ. Ако нешто е во ред (на пр. примен аванс), означете „✓ проверено“ со белешка.</b>
          : all.some((x) => x.sev === 'block')
            ? 'Сите наоди се средени или означени како проверени – може да се продолжи.'
            : 'Нема плаќања без фактура, благајната и залихата не одат во минус, сè е прокнижено.'}
      </p>
      {all.length > 0 && (
        <div className="tw"><table className="dense">
          <thead><tr><th style={{ width: 110 }}>Област</th><th>Наод</th><th style={{ width: 300 }} /></tr></thead>
          <tbody>
            {all.map((x) => {
              const a = ack[x.key];
              const href = goHref(x);
              return (
                <tr key={x.key} style={a ? { opacity: 0.6 } : undefined}>
                  <td><span className={`pill ${x.sev === 'block' ? (a ? '' : 'bad') : 'warn'}`}>{x.area}</span></td>
                  <td>{x.txt}{a && <div className="mini">✓ проверено: {a.note} – {a.by} {dmy(String(a.at ?? '').slice(0, 10))}</div>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {href && <Link className="btn sm" href={href}>Отвори</Link>}{' '}
                    {canDist && (x.key === 'np12' || x.key === 'np22') && <><Link className="btn sm pri" href={`/zsKontrola?np=${x.key.slice(2)}`}>⇄ Распредели по партнери</Link>{' '}</>}
                    {x.sev === 'block' && canAck && (a
                      ? <RowAction action={unackFinding.bind(null, x.key)} label="↺" title="Врати како неразрешено" />
                      : (
                        <ActionForm action={ackFinding.bind(null, x.key)} className="row" style={{ display: 'inline-flex', gap: 4 }}>
                          <input name="note" placeholder="Зошто е во ред?" style={{ width: 150 }} required />
                          <button className="btn sm">✓ проверено</button>
                        </ActionForm>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
