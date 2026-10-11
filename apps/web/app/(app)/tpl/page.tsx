/**
 * Legacy `VIEWS.tpl` 16136 — „📄 Сопствени Word шаблони“: for every document of the program (grouped as legacy
 * `tplKinds`) the built-in one or your own .docx: ⬆ Прикачи .docx (new version, the older stays in 🕘 Верзии),
 * 📋 Полиња, 🧪 Проба (filled for the current firm), ↺ Вграден. Plus free documents filled with the common fields.
 */
import { desc, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { TPL_COMMON, tplKinds } from '@wise/core/office';
import { users, wordTemplates } from '@wise/db';
import { db } from '@/lib/db';
import { firmTemplateVars, officePage } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd, dmy, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { deleteTemplate, saveTemplate, setTemplateActive, useBuiltin } from './actions';

export default async function TplPage() {
  const { u, firm } = await officePage('tpl', { perm: 'office' });
  const K = tplKinds();
  const T = await db().select({ t: wordTemplates, by: users.name }).from(wordTemplates).leftJoin(users, eq(users.id, wordTemplates.createdBy)).orderBy(desc(wordTemplates.createdAt));
  const V = firm ? await firmTemplateVars(firm) : {};
  const grps = [...new Set(K.filter((k) => k.key !== 'free').map((k) => k.grp))];
  const own = can(u.principal, 'settings');
  const del = can(u.principal, 'del');
  const free = T.filter(({ t }) => t.kind === 'free');

  const Upload = ({ kind, name, label }: { kind: string; name: string; label: string }) => (
    <details style={{ display: 'inline-block' }}><summary className="btn sm">{label}</summary>
      <ActionForm action={saveTemplate} className="card" style={{ position: 'absolute', zIndex: 5, minWidth: 320 }}>
        <input type="hidden" name="kind" value={kind} />{name ? <input type="hidden" name="name" value={name} /> : <label className="f">Назив<input name="name" required /></label>}
        <UploadField firmId={null} accept=".docx,.doc" label="📎 Word (.docx)" />
        <button className="btn pri sm">Зачувај и вклучи</button>
      </ActionForm>
    </details>
  );

  return (
    <>
      <Hd t="📄 Сопствени Word шаблони" sub="за секој документ: вграден или ваш">
        <a className="btn" href="/api/office/tpl/sample">⬇ Пример шаблон</a>
      </Hd>
      <div className="callout"><b>Како:</b> 1) преземете го вградениот документ во Word (или земете ваш постоечки); 2) на местата каде што треба податоци напишете поле во двојни загради, пр. <code>{'{{ФИРМА}}'}</code>, <code>{'{{ФИРМА_ЕДБ}}'}</code>, <code>{'{{ДАТУМ}}'}</code> (листа: „📋 Полиња“); 3) зачувајте како <b>.docx</b> и прикачете. Од тогаш програмата го пополнува вашиот шаблон автоматски (Word и PDF). Вградениот секогаш може да се врати; старите верзии <b>не се бришат</b>.{!own && <><br />🔒 Прикачување и менување – само сопственикот / главниот сметководител.</>}</div>
      {grps.map((g) => (
        <div key={g} className="card tw">
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{g}</h2>
          <table className="dense"><tbody>
            {K.filter((k) => k.grp === g).map((k) => {
              const vs = T.filter(({ t }) => t.kind === k.key);
              const cur = vs.find(({ t }) => t.active);
              const fields = [...new Set([...k.vars, ...TPL_COMMON])];
              return (
                <tr key={k.key}>
                  <td><b>{k.name}</b></td>
                  <td>{cur ? <><span className="pill good">Сопствен</span><div className="mini muted">{cur.t.name} v{cur.t.version} · {dmy(cur.t.createdAt.toISOString())} · {cur.by ?? ''}</div></>
                    : <><span className="pill">Вграден</span>{vs.length > 0 && <div className="mini muted">{vs.length} прикачени верзии (неактивни)</div>}</>}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {own && <Upload kind={k.key} name={k.name} label="⬆ Прикачи .docx" />}{' '}
                    <details style={{ display: 'inline-block' }}><summary className="btn sm">📋 Полиња</summary>
                      <div className="card" style={{ position: 'absolute', zIndex: 5, maxWidth: 420, textAlign: 'left' }}>
                        <p className="mini" style={{ margin: '0 0 4px' }}>За овој документ:</p>
                        {fields.map((v) => <code key={v} style={{ marginRight: 6, display: 'inline-block' }} className={firm ? (V[v] ? '' : 'muted') : ''}>{`{{${v}}}`}</code>)}
                        {cur && cur.t.vars.some((v) => !fields.includes(v)) && <p className="mini">⚠ Полиња без вредност во шаблонот: {cur.t.vars.filter((v) => !fields.includes(v)).join(', ')}</p>}
                      </div>
                    </details>{' '}
                    {vs.length > 0 && (
                      <details style={{ display: 'inline-block' }}><summary className="btn sm">🕘 Верзии</summary>
                        <div className="card" style={{ position: 'absolute', zIndex: 5, minWidth: 380, right: 16, textAlign: 'left' }}>
                          <table className="dense"><tbody>{vs.map(({ t, by }) => (
                            <tr key={t.id}><td>v{t.version}{t.active && <> <span className="pill good">активна</span></>}</td><td className="mini">{dmyHm(t.createdAt)} · {by ?? ''}</td>
                              <td style={{ whiteSpace: 'nowrap' }}><a className="btn sm" href={`/api/files/${t.fileId}?dl=1`}>⬇</a>{own && !t.active && <RowAction action={setTemplateActive.bind(null, t.id, true)} label="Вклучи" />}{del && <RowAction action={deleteTemplate.bind(null, t.id)} label="✕" confirm={`Да се избрише v${t.version}?`} />}</td></tr>
                          ))}</tbody></table>
                        </div>
                      </details>
                    )}{' '}
                    {cur && (firm ? <a className="btn sm" href={`/api/office/tpl/${cur.t.id}`} title="Пополнет за тековната фирма">🧪 Проба</a> : <span className="mini muted">🧪 Проба – изберете фирма</span>)}{' '}
                    {own && cur && <RowAction className="btn sm ghost" action={useBuiltin.bind(null, k.key)} label="↺ Вграден" confirm="Да се користи вградениот документ? Вашиот шаблон останува во „Верзии“." />}
                  </td>
                </tr>
              );
            })}
          </tbody></table>
        </div>
      ))}
      <div className="card tw">
        <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Слободни документи (само општи податоци)</h2>{own && <Upload kind="free" name="" label="+ Нов слободен шаблон" />}</div>
        {free.length ? <table className="dense"><tbody>{free.map(({ t, by }) => (
          <tr key={t.id} style={t.active ? undefined : { opacity: 0.55 }}><td><b>{t.name}</b> v{t.version}</td><td className="mini">{by} · {dmyHm(t.createdAt)}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{firm && t.active && <a className="btn sm pri" href={`/api/office/tpl/${t.id}`}>⬇ Пополни за фирмата</a>} <a className="btn sm" href={`/api/files/${t.fileId}?dl=1`}>Оригинал</a> <RowAction action={setTemplateActive.bind(null, t.id, !t.active)} label={t.active ? 'Исклучи' : 'Вклучи'} />{del && <RowAction action={deleteTemplate.bind(null, t.id)} label="✕" confirm={`Да се избрише „${t.name}“ v${t.version}?`} />}</td></tr>
        ))}</tbody></table> : <p className="note">Нема слободни шаблони.</p>}
      </div>
      <div className="card">
        <h2 style={{ fontSize: 15 }}>Општи полиња {firm && `– ${firm.name}`}</h2>
        <table className="dense"><tbody>
          {TPL_COMMON.map((k) => <tr key={k}><td><code>{`{{${k}}}`}</code></td><td>{V[k] ?? <span className="note">— нема податок —</span>}</td></tr>)}
        </tbody></table>
      </div>
    </>
  );
}
