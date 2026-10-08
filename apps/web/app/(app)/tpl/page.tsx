/** Legacy `VIEWS.tpl` **16136** — Word (.docx) templates filled with firm and office data. */
import { desc, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { TPL_COMMON, tplKinds } from '@wise/core/office';
import { users, wordTemplates } from '@wise/db';
import { db } from '@/lib/db';
import { firmTemplateVars, officePage } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { deleteTemplate, saveTemplate, setTemplateActive } from './actions';

export default async function TplPage() {
  const { u, firm } = await officePage('tpl', { perm: 'office' });
  const K = tplKinds();
  const T = await db().select({ t: wordTemplates, by: users.name }).from(wordTemplates).leftJoin(users, eq(users.id, wordTemplates.createdBy)).orderBy(desc(wordTemplates.createdAt));
  const V = firm ? await firmTemplateVars(firm) : {};
  const grps = [...new Set(K.map((k) => k.grp))];
  const del = can(u.principal, 'del');
  return (
    <>
      <Hd t="📄 Шаблони (Word)" sub={firm ? `пополнување за ${firm.name}` : 'изберете фирма за пополнување'}>
        <a className="btn" href="/api/office/tpl/sample">⬇ Пример шаблон</a>
      </Hd>
      <ActionForm action={saveTemplate}>
        <h2>+ Нов шаблон</h2>
        <p className="note" style={{ margin: 0 }}>Во Word напишете ги полињата во двојни загради, на пр. <code>{'{{ФИРМА}}'}</code>, <code>{'{{ФИРМА_ЕДБ}}'}</code>, <code>{'{{ДАТУМ}}'}</code>.</p>
        <div className="form">
          <label className="f">Назив<input name="name" required /></label>
          <label className="f">Вид на документ<select name="kind" defaultValue="free">
            {grps.map((g) => <optgroup key={g} label={g}>{K.filter((k) => k.grp === g).map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</optgroup>)}
          </select></label>
          <UploadField firmId={null} accept=".docx" label="📎 Word (.docx)" />
        </div>
        <div className="row"><button className="btn pri">Зачувај</button></div>
      </ActionForm>

      {T.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Шаблон</th><th>Вид</th><th>Полиња</th><th>Верзија</th><th>Прикачил</th><th></th></tr></thead>
          <tbody>
            {T.map(({ t, by }) => {
              const miss = t.vars.filter((v) => !V[v]);
              return (
                <tr key={t.id} style={t.active ? undefined : { opacity: 0.55 }}>
                  <td><b>{t.name}</b></td>
                  <td>{K.find((k) => k.key === t.kind)?.name ?? t.kind}</td>
                  <td className="mini">{t.vars.map((v) => <span key={v} className={`pill ${V[v] ? 'good' : firm ? 'warn' : ''}`} style={{ marginRight: 3 }}>{v}</span>)}</td>
                  <td>v{t.version}</td>
                  <td className="mini">{by} · {dmyHm(t.createdAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {firm && t.active && <a className="btn sm pri" href={`/api/office/tpl/${t.id}`} title={miss.length ? `Без податок: ${miss.join(', ')}` : undefined}>⬇ Пополни за фирмата</a>}{' '}
                    <a className="btn sm" href={`/api/files/${t.fileId}?dl=1`}>Оригинал</a>{' '}
                    <RowAction action={setTemplateActive.bind(null, t.id, !t.active)} label={t.active ? 'Исклучи' : 'Вклучи'} />
                    {del && <RowAction action={deleteTemplate.bind(null, t.id)} label="✕" confirm={`Да се избрише „${t.name}“ v${t.version}?`} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      ) : <div className="card empty">Нема шаблони.</div>}

      <div className="card">
        <h2 style={{ fontSize: 15 }}>Општи полиња {firm && `– ${firm.name}`}</h2>
        <table className="dense"><tbody>
          {TPL_COMMON.map((k) => <tr key={k}><td><code>{`{{${k}}}`}</code></td><td>{V[k] ?? <span className="note">— нема податок —</span>}</td></tr>)}
        </tbody></table>
      </div>
    </>
  );
}
