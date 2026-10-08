import { and, desc, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { files, users } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { Hd, dmyHm } from '@/components/hd';
import { UploadBox } from './upload-box';

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Document archive of the current firm (files in MinIO). Linking to documents comes with each module. */
export default async function ArhivaPage() {
  const u = await requireUser();
  const firm = await currentFirm(u);
  if (!firm) return <><Hd t="📂 Архива на документи" /><div className="callout">Изберете фирма со <b>⇄ Промени фирма</b>.</div></>;
  const L = await db()
    .select({ f: files, by: users.name })
    .from(files)
    .leftJoin(users, eq(users.id, files.uploadedBy))
    .where(and(eq(files.firmId, firm.id), eq(files.status, 'ready')))
    .orderBy(desc(files.createdAt))
    .limit(500);
  return (
    <>
      <Hd t="📂 Архива на документи" sub={`${firm.name} · ${L.length} документи`} />
      {can(u.principal, 'write', firm.id) && <UploadBox firmId={firm.id} />}
      <div className="tw"><table>
        <thead><tr><th>Датотека</th><th>Тип</th><th className="n">Големина</th><th>Прикачил</th><th>Време</th><th></th></tr></thead>
        <tbody>
          {L.map(({ f, by }) => (
            <tr key={f.id}>
              <td><a href={`/api/files/${f.id}`} target="_blank" rel="noopener">{f.name}</a></td>
              <td><small className="mini">{f.mime}</small></td>
              <td className="n">{kb(f.size)}</td>
              <td>{by ?? '—'}</td>
              <td className="num">{dmyHm(f.createdAt)}</td>
              <td><a className="btn sm" href={`/api/files/${f.id}?dl=1`}>⬇ Преземи</a></td>
            </tr>
          ))}
          {!L.length && <tr><td colSpan={6} className="mut">Нема прикачени документи.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
