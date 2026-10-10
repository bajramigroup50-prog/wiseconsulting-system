/**
 * Legacy `VIEWS.sistem` 8992 + `bkRestHTML` — Систем › Податоци и резервна копија, server version:
 *  - status of the nightly server backup (whole database + document bucket, `docker/backup.sh`) instead of the
 *    in-browser daily copy (`bkpRun`, `bk_auto` in localStorage);
 *  - „⬇ Само оваа фирма (JSON)“ (`backupJson`) and „💾 Направи копија сега“ for the current firm, kept in its archive;
 *  - restore of a firm from such a copy (administrator, `del`), with an automatic copy of the current state first;
 *  - record counts of the firm per table (legacy „Оваа фирма – записи“ per collection).
 */
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { backupCounts, files, firmBackupFiles, firmRecordCounts, firms, parseFirmBackup, PRE_RESTORE_PREFIX, users } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { getObjectBytes } from '@/lib/storage';
import { lastServerBackup } from '@/lib/sysdata';
import { ActionForm } from '@/components/action-form';
import { Hd, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { backupNowAction, pickRestoreAction, restoreAction } from './actions';

const tsz = (v: number) => (v > 1048576 ? `${(v / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(v / 1024))} KB`);

export default async function SistemPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('sistem');
  const srv = await lastServerBackup();
  const age = srv ? Math.round((Date.now() - new Date(srv.at).getTime()) / 36e5) : null;
  const settings = !!firm && can(u.principal, 'settings', firm.id);
  const admin = !!firm && u.role === 'admin' && can(u.principal, 'del', firm.id);

  const [copies, counts] = firm
    ? await Promise.all([
      db().select({ f: files, by: users.name }).from(files).leftJoin(users, eq(users.id, files.uploadedBy))
        .where(eq(files.firmId, firm.id)).then(async (R) => {
          const keep = new Set((await firmBackupFiles(db(), firm.id)).map((f) => f.id));
          return R.filter((r) => keep.has(r.f.id)).sort((a, b) => +b.f.createdAt - +a.f.createdAt);
        }),
      firmRecordCounts(db(), firm.id),
    ])
    : [[], []];

  // Restore confirmation (legacy `bkRestHTML`).
  let rest: { id: string; name: string; at: string; target: string; exists: boolean; counts: [string, number][] } | { error: string } | null = null;
  if (firm && admin && sp.r && /^[0-9a-f-]{36}$/i.test(sp.r)) {
    const [f] = await db().select().from(files).where(and(eq(files.id, sp.r), eq(files.firmId, firm.id), eq(files.status, 'ready'))).limit(1);
    if (!f) rest = { error: 'Датотеката не постои.' };
    else {
      try {
        const B = parseFirmBackup(new TextDecoder().decode(await getObjectBytes(f.bucketKey)));
        const [ex] = await db().select({ id: firms.id }).from(firms).where(eq(firms.id, String(B.firm.id))).limit(1);
        rest = { id: f.id, name: String(B.firm.name ?? ''), at: B.at, target: String(B.firm.id), exists: !!ex, counts: Object.entries(backupCounts(B)).filter(([, n]) => n > 0) };
      } catch (e) { rest = { error: e instanceof Error ? e.message : 'Датотеката не може да се прочита.' }; }
    }
  }

  return (
    <>
      <Hd t="Податоци и резервна копија" sub={firm?.name}>
        {firm && <a className="btn" href="/sistem/export">⬇ Само оваа фирма (JSON)</a>}
        {settings && <RowAction action={backupNowAction} label="💾 Направи копија сега (оваа фирма)" className="btn pri" />}
      </Hd>

      <div className="card" style={{ borderLeft: `4px solid ${!srv ? 'var(--bad)' : age! > 30 ? '#e08a00' : '#1f8a4c'}` }}>
        <b>{!srv ? '⚠ Нема запис за ноќна резервна копија на серверот.' : `Последна копија на серверот: ${dmyHm(new Date(srv.at))}${srv.size ? ` · база ${tsz(srv.size)}` : ''}${srv.kept ? ` · се чуваат ${srv.kept} копии` : ''}`}</b>
        <p className="note" style={{ margin: '6px 0 0' }}>
          Резервната копија на серверот ги зачувува <b>сите фирми</b> (целата база: документи, налози, плати, шифрарници) и сите скенирани документи.
          Се прави автоматски <b>секоја ноќ</b>, а се чуваат копиите од последните 30 дена. За дополнителна сигурност, преземете ја копијата на
          фирмата (JSON) на вашиот компјутер или надворешен диск.{!srv && ' Ако копијата сè уште не е поставена, проверете го ноќниот cron на серверот (docker/backup.sh).'}
        </p>
      </div>

      {!firm ? <div className="callout">Изберете фирма за копија и враќање на податоците на фирмата.</div> : (
        <>
          <div className="card">
            <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Копии на оваа фирма ({copies.length})</h2>
            <div className="tw" style={{ maxHeight: 340 }}><table className="dense">
              <thead><tr><th>Датум и време</th><th>Вид</th><th>Направил</th><th className="n">Големина</th><th></th></tr></thead>
              <tbody>
                {copies.map(({ f, by }) => (
                  <tr key={f.id}>
                    <td>{dmyHm(f.createdAt)}</td>
                    <td>{f.name.startsWith(PRE_RESTORE_PREFIX) ? 'пред враќање' : 'рачна'}</td>
                    <td>{by ?? ''}</td>
                    <td className="n">{tsz(f.size)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <a className="btn sm" href={`/api/files/${f.id}?dl=1`}>⬇ JSON</a>
                      {admin && <Link className="btn sm" href={`/sistem?r=${f.id}`}>↺ Врати…</Link>}
                    </td>
                  </tr>
                ))}
                {!copies.length && <tr><td colSpan={5} className="note">Нема копии.</td></tr>}
              </tbody>
            </table></div>
            {admin && (
              <ActionForm action={pickRestoreAction} className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
                <UploadField firmId={firm.id} accept=".json,application/json" label="↺ Врати од датотека (JSON – „Само оваа фирма“)" />
                <button className="btn">Продолжи</button>
                <span className="mini">Враќањето е дозволено само за администратор.</span>
              </ActionForm>
            )}
          </div>

          {rest && ('error' in rest ? <div className="callout bad">{rest.error}</div> : (
            <div className="card" style={{ borderColor: 'var(--bad)' }}>
              <div className="hd"><h2 style={{ fontSize: 15 }}>↺ Враќање од резервна копија од {dmyHm(new Date(rest.at))}</h2><Link className="btn sm" href="/sistem">✕</Link></div>
              <div className="callout warn">Враќањето ја <b>заменува</b> состојбата на фирмата <b>{rest.name}</b> со состојбата од копијата: сè што е внесено после копијата за таа фирма ќе биде избришано. Пред враќањето автоматски се прави нова копија од сегашната состојба. Прикачените документи (архива) остануваат.
                {rest.target !== firm.id && <> <b>Копијата е од друга фирма</b>{rest.exists ? ' – ќе се врати таа фирма, не тековната.' : ' која не постои – ќе биде создадена.'}</>}</div>
              <p className="mini">{rest.counts.map(([k, n]) => `${k}: ${n}`).join(' · ')}</p>
              <div className="row" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} />
                <RowAction action={restoreAction.bind(null, rest.id)} label="↺ Врати ја фирмата" className="btn danger" confirm={`Да се врати „${rest.name}“ на состојбата од копијата? Ова не може да се поништи (освен со новата копија).`} />
              </div>
            </div>
          ))}

          <div className="card">
            <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Оваа фирма – записи</h2>
            <div className="tw"><table className="dense">
              <thead><tr><th>Збирка</th><th className="n">Записи</th></tr></thead>
              <tbody>{counts.filter((c) => c.n > 0).map((c) => <tr key={c.table}><td>{c.table}</td><td className="n">{c.n}</td></tr>)}</tbody>
            </table></div>
          </div>
        </>
      )}
    </>
  );
}
