/**
 * Legacy `VIEWS.autop` 16316 … 16663 — Автопилот: KPI (подготвени / предупредувања / проблеми), tabs Фирми,
 * Пораки до клиенти (kinds with „👁 N фирми – види што недостасува“, automatic sending per kind, editable messages:
 * портал + е-пошта / Само портал / Прескокни), Затворање на период (period, readiness per firm, „📨 Побарај од
 * клиентот“, ДДВ-04 bases with selection, print and close), Ризик од контрола, Даноци, Инспекции, Даночен преглед.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { can } from '@wise/core';
import { AL_DESC } from '@wise/core/office';
import { AP_CL_MODES, apClCustom } from '@wise/core/office/ap-close';
import { AP_TYPES, apFirmRows, apKpi, apPeers, apRiskClass, apTypeName, apWhat } from '@wise/core/office/autop-view';
import { autopilotFindings, autopilotMessages, autopilotMetrics, autopilotRuns, getOfficeProfile } from '@wise/db';
import { apCloseRows } from '@/lib/ap-close';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { allowedFirms, officePage, today } from '@/lib/office';
import { hrefFor } from '@/lib/nav';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { FirmGo } from '@/components/firm-go';
import { Hd, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { ackFinding, runNow, saveAutopilotSettings, sendClientMessage, setAutoType, skipMessage } from './actions';
import { CloseTable } from './close-table';

const LV: Record<string, string> = { bad: 'bad', warn: 'warn', info: 'info' };
type SP = { tab?: string; f?: string; mode?: string; c?: string; go?: string };

export default async function AutopPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const tab = ['msg', 'close', 'risk', 'tax'].includes(sp.tab ?? '') ? sp.tab! : 'firms';
  const { u, firm: cur } = await officePage('autop', { perm: 'office' });
  const F = await allowedFirms(u);
  const ids = F.map((f) => f.id);
  const fname = (id: string) => F.find((f) => f.id === id)?.name ?? '';
  const [[run], O] = await Promise.all([db().select().from(autopilotRuns).orderBy(desc(autopilotRuns.startedAt)).limit(1), getOfficeProfile(db())]);
  const [find, msgs, met] = ids.length ? await Promise.all([
    db().select().from(autopilotFindings).where(and(inArray(autopilotFindings.firmId, ids), isNull(autopilotFindings.resolvedAt), isNull(autopilotFindings.ackAt))),
    db().select().from(autopilotMessages).where(and(inArray(autopilotMessages.firmId, ids), eq(autopilotMessages.status, 'proposed'))).orderBy(desc(autopilotMessages.createdAt)),
    db().select().from(autopilotMetrics).where(inArray(autopilotMetrics.firmId, ids)),
  ]) : [[], [], []];
  const rows = apFirmRows(F, (f) => find.filter((x) => x.firmId === f.id));
  const K = apKpi(rows);
  const own = can(u.principal, 'settings');
  const AU = (O.apAuto ?? {}) as Record<string, boolean>;
  const td = today();
  const tabs: [string, string][] = [['firms', `🏢 Фирми (${F.length})`], ['msg', `📨 Пораки до клиенти (${msgs.length})`], ['close', '✅ Затворање на период'], ['risk', '🎯 Ризик од контрола'], ['tax', '🧮 Даноци']];
  const metOf = (id: string) => (met.find((m) => m.firmId === id)?.metrics ?? {}) as Record<string, unknown>;

  // Затворање: the period mode and the check (legacy „▶ Провери го периодот“)
  const mode = sp.mode === 'custom' ? (apClCustom(sp.c) ?? '') : (sp.mode ?? 'auto');
  const badCustom = sp.mode === 'custom' && !apClCustom(sp.c);
  const cl = tab === 'close' && sp.go && !badCustom ? await apCloseRows(F, mode, td) : null;

  return (
    <>
      <Hd t="🤖 Автопилот" sub="секое утро: сите фирми проверени, вие ги решавате само проблемите">
        <RowAction className="btn pri" action={runNow} label="🔄 Провери сега" />
      </Hd>
      <p className="note">{run ? `Последна проверка ${dmyHm(run.finishedAt ?? run.startedAt)} · ${run.firms} фирми. ` : 'Сè уште не е пуштен. '}Се пушта автоматски на секои 6 часа; наодите исчезнуваат сами кога ќе се реши проблемот.</p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
        {([['✓ Подготвени', K.ok, 'good'], ['⚠ Со предупредувања', K.warn, 'warn'], ['⛔ Со проблеми', K.bad, 'bad']] as const).map(([t, n, c]) => (
          <div key={t} className="card" style={{ flex: 1, minWidth: 160, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>{t}</div><div style={{ fontSize: 24, fontWeight: 700 }} className={c}>{n}</div></div>
        ))}
      </div>
      <div className="row" style={{ gap: 6, margin: '6px 0', flexWrap: 'wrap' }}>
        {tabs.map(([k, l]) => <a key={k} className={`btn ${tab === k ? 'pri' : ''}`} href={`/autop?tab=${k}`}>{l}</a>)}
        <a className="btn" href="/insp">🛡 Инспекции</a>
        <a className="btn" href="/lawrep?all=1">⚖️ Даночен преглед</a>
      </div>

      {tab === 'firms' && (
        <div className="card tw"><table className="dense">
          <thead><tr><th>Фирма</th><th>Состојба</th><th>Што треба да се реши</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.f.id}>
              <td><b>{r.f.name}</b></td>
              <td>{r.bad ? <Pill c="bad">⛔ {r.bad}</Pill> : r.warn ? <Pill c="warn">⚠ {r.warn}</Pill> : <Pill c="good">✓ подготвена</Pill>}</td>
              <td style={{ fontSize: 12.5 }}>{r.I.length ? find.filter((x) => x.firmId === r.f.id && x.lvl !== 'info').map((x) => (
                <div key={x.id} title={AL_DESC[x.cat]}><Pill c={LV[x.lvl]}>{x.cat}</Pill> {x.txt} <RowAction action={ackFinding.bind(null, x.id)} label="✓" title="Видено – не прикажувај" /></div>
              )) : <span className="muted">—</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}><FirmGo fid={r.f.id} current={cur?.id} to={hrefFor(find.find((x) => x.firmId === r.f.id && x.go)?.go ?? 'home')} className="btn sm">Отвори →</FirmGo></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {tab === 'msg' && (
        <>
          <div className="card">
            <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Начин на праќање по вид</h2>
            <p className="note" style={{ margin: '0 0 8px' }}>Програмата сама ги составува пораките – вие ја прегледувате и ја праќате секоја порака. Ако вклучите „автоматски“, програмата ја праќа сама (портал + е-пошта) при утринската проверка, најмногу еднаш по фирма и период.</p>
            <table className="dense"><thead><tr><th>Вид на порака</th><th>Кај кои фирми недостасува</th><th>Праќање</th></tr></thead>
              <tbody>{AP_TYPES.map(([k, n, d]) => {
                const G = msgs.filter((g) => g.type === k), open = sp.f === k;
                return (
                  <tr key={k}>
                    <td style={{ verticalAlign: 'top' }}><b>{n}</b><div className="muted" style={{ fontSize: 12 }}>{d}</div></td>
                    <td style={{ verticalAlign: 'top' }}>{G.length ? <>
                      <a className={`btn sm ${open ? 'pri' : ''}`} href={`/autop?tab=msg&f=${open ? '' : k}`}>👁 {G.length} {G.length === 1 ? 'фирма' : 'фирми'} – види што недостасува</a>
                      {open && <div style={{ marginTop: 6, fontSize: 12.5 }}>{G.map((g) => <div key={g.key} style={{ padding: '4px 0', borderTop: '1px solid var(--line)' }}><b>{fname(g.firmId)}</b>: {apWhat(g)}</div>)}</div>}
                    </> : <span className="muted">✓ ништо не недостасува</span>}</td>
                    <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      {own ? <RowAction action={setAutoType.bind(null, k, !AU[k])} className={`btn sm ${AU[k] ? 'pri' : ''}`} label={AU[k] ? '🤖 Автоматски (директно до клиентот) – исклучи' : 'Рачно – вклучи автоматски'}
                        confirm={AU[k] ? undefined : `„${n}“ – АВТОМАТСКИ\n\nПораките од овој вид ќе одат ДИРЕКТНО до клиентите (портал + е-пошта), без ваш преглед, при секоја утринска проверка (најмногу еднаш по фирма и период).${G.length ? `\n\nВеднаш ќе се испратат ${G.length} пораки што сега чекаат.` : ''}\n\nДа вклучам?`} />
                        : AU[k] ? <b>автоматски (директно до клиентот)</b> : 'рачно'}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {sp.f && <div className="row" style={{ gap: 8, alignItems: 'center', margin: '4px 0' }}><b>Прикажани: {apTypeName(sp.f)}</b><a className="btn sm" href="/autop?tab=msg">Прикажи ги сите пораки</a></div>}
          {msgs.length ? msgs.filter((g) => !sp.f || g.type === sp.f).map((g) => {
            const email = F.find((f) => f.id === g.firmId)?.email;
            return (
              <ActionForm key={g.key} action={sendClientMessage} reset={false}>
                <input type="hidden" name="key" value={g.key} />
                <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div><b>{fname(g.firmId)}</b> · {apTypeName(g.type)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{email ? `✉ ${email}` : 'нема е-пошта – само портал'}</div>
                </div>
                <input name="subject" defaultValue={g.subject} style={{ width: '100%', margin: '6px 0' }} />
                <textarea name="body" rows={7} style={{ width: '100%' }} defaultValue={g.body} />
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button className="btn pri sm">📨 Испрати (портал{email ? ' + е-пошта' : ''})</button>
                  <button className="btn sm" name="only" value="portal">Само портал</button>
                  <RowAction action={skipMessage.bind(null, g.key)} label="Прескокни" />
                </div>
              </ActionForm>
            );
          }) : <div className="card empty">Нема пораки за праќање. ✓</div>}
        </>
      )}

      {tab === 'close' && (
        <>
          <form className="card">
            <input type="hidden" name="tab" value="close" /><input type="hidden" name="go" value="1" />
            <div className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
              <label className="f" style={{ margin: 0, minWidth: 320 }}>Период за затворање
                <select name="mode" defaultValue={sp.mode ?? 'auto'}>{AP_CL_MODES(td).map(([k, n]) => <option key={k} value={k}>{n}</option>)}<option value="custom">Друг период…</option></select>
              </label>
              <label className="f" style={{ margin: 0 }}>Месец (ГГГГ-ММ) или квартал (ГГГГ-Т1)<input name="c" defaultValue={sp.c ?? ''} placeholder={AP_CL_MODES(td)[1]![1].slice(-8, -1).replace('/', '-')} style={{ width: 140 }} /></label>
              <button className="btn pri">▶ Провери го периодот</button>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>За секоја фирма: проблемите од утринската проверка (изводи, влезни и излезни фактури, благајна, фискални Z, плати), документи на чекање и ДДВ-04. Кога сè е ✓ – периодот може да се затвори (книжи ДДВ-04).</p>
          </form>
          {badCustom && <div className="callout bad">Внесете период: 2026-09 или 2026-Т3</div>}
          {cl && (cl.length ? <>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
              {([['✅ Затворени (ДДВ книжена)', cl.filter((r) => r.closed).length, 'good'], ['🟢 Подготвени за затворање', cl.filter((r) => r.ready && !r.closed).length, 'good'], ['🔴 Недостасува нешто', cl.filter((r) => !r.ready).length, 'bad']] as const).map(([t, n, c]) => (
                <div key={t} className="card" style={{ flex: 1, minWidth: 180, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>{t}</div><div style={{ fontSize: 24, fontWeight: 700 }} className={c}>{n}</div></div>
              ))}
            </div>
            <CloseTable mode={mode} rows={cl.map((r) => ({ id: r.firm.id, name: (r.firm.settings as { short?: string }).short || r.firm.name, label: r.label, month: r.kind === 'month', fields: r.fields, closed: r.closed, ready: r.ready }))} />
            <div className="card tw"><table className="dense">
              <thead><tr><th>Фирма</th><th>Период</th><th>Готово</th><th>Што недостасува</th><th></th></tr></thead>
              <tbody>{cl.map((r) => (
                <tr key={r.firm.id}>
                  <td><b>{r.firm.name}</b></td><td style={{ whiteSpace: 'nowrap' }}>{r.label}</td>
                  <td><Pill c={r.closed || r.ready ? 'good' : 'bad'}>{r.closed ? '✅ затворен' : r.ready ? '✓ подготвен' : '✗'}</Pill></td>
                  <td style={{ fontSize: 12.5 }}>{r.miss.length ? r.miss.map((m, i) => <div key={i}>✗ {m}</div>) : '✓ сè е во ред'}</td>
                  <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    <FirmGo fid={r.firm.id} current={cur?.id} to="/ddv" className="btn sm">Отвори →</FirmGo>
                    {r.miss.length > 0 && (
                      <details><summary className="btn sm" style={{ marginTop: 4 }}>📨 Побарај од клиентот</summary>
                        <ActionForm action={sendClientMessage} className="" reset={false}>
                          <input type="hidden" name="key" value={`cl|${r.firm.id}|${r.period}`} /><input type="hidden" name="firmId" value={r.firm.id} /><input type="hidden" name="type" value="close" />
                          <input name="subject" defaultValue={`📨 Документи за затворање – ${r.label}`} style={{ width: '100%', margin: '6px 0' }} />
                          <textarea name="body" rows={8} style={{ width: '100%' }} defaultValue={`Почитувани,\n\nЗа да го затвориме периодот ${r.label} за ${r.firm.name}, ни недостасува:\n\n${r.miss.map((m) => '• ' + m).join('\n')}\n\nВе молиме испратете ги преку порталот или по е-пошта.\n\nСо почит,`} />
                          <div className="row" style={{ gap: 6 }}><button className="btn pri sm">📨 Испрати (портал + е-пошта)</button><button className="btn sm" name="only" value="portal">Само портал</button></div>
                        </ActionForm>
                      </details>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          </> : <div className="callout">Во избраниот период нема фирми ДДВ обврзници чиј ДДВ период одговара (месечните се затвораат по месец, квартални по квартал).</div>)}
        </>
      )}

      {tab === 'risk' && (() => {
        const peers = apPeers(met.map((m) => ({ firmId: m.firmId, m: m.metrics as Record<string, unknown> })));
        return (
          <>
            <div className="callout">Секоја фирма се споредува со другите ваши фирми од <b>истата дејност</b> (анонимно): маржа, просечна плата, удел на готовина, трошоци. Големи отстапувања се она што УЈП го бара при избор за контрола. <b>Ова е проценка за ваша внатрешна употреба, не одлука на УЈП.</b></div>
            <div className="card tw"><table className="dense">
              <thead><tr><th>Фирма</th><th>Дејност</th><th className="n">Ризик</th><th>Причини</th><th className="n">Слични</th></tr></thead>
              <tbody>{[...met].filter((m) => Number(metOf(m.firmId).rev) > 0).sort((a, b) => b.risk - a.risk).map((m) => (
                <tr key={m.firmId}><td><b>{fname(m.firmId)}</b></td><td>{String(metOf(m.firmId).nkd ?? '—')}</td><td className="n"><Pill c={apRiskClass(m.risk)}>{m.risk}</Pill></td>
                  <td style={{ fontSize: 12.5 }}>{m.riskWhy.length ? m.riskWhy.map((w, i) => <div key={i}>{w}</div>) : <span className="muted">без отстапувања</span>}</td><td className="n">{peers.get(m.firmId) ?? 0}</td></tr>
              ))}</tbody>
            </table></div>
          </>
        );
      })()}

      {tab === 'tax' && (
        <div className="card tw"><table className="dense">
          <thead><tr><th>Фирма</th><th className="n">ДДВ досега (тековен период)</th><th className="n">Проценка до крај</th><th className="n">Аконтација</th><th></th></tr></thead>
          <tbody>{F.filter((f) => metOf(f.id).vatNow != null).map((f) => {
            const m = metOf(f.id), ak = Number((f.settings as { akontDD?: unknown }).akontDD) || 0;
            return (
              <tr key={f.id}><td><b>{f.name}</b></td><td className="n">{fmt(Number(m.vatNow))}</td><td className="n">{fmt(Math.max(0, Number(m.vatEst) || 0))}</td><td className="n">{ak ? fmt(ak) : '—'}</td>
                <td>{msgs.some((g) => g.firmId === f.id && g.type === 'vat') && <a className="btn sm" href="/autop?tab=msg&f=vat">📨 Порака</a>}</td></tr>
            );
          })}</tbody>
        </table></div>
      )}

      <ActionForm action={saveAutopilotSettings} reset={false}>
        <h2 style={{ fontSize: 15 }}>Поставки</h2>
        <label className="chk" style={{ display: 'block' }}><input type="checkbox" name="apTasks" defaultChecked={!!O.apTasks} disabled={!own} /> Креирај задача во Канцеларија за секој нов проблем</label>
        {AP_TYPES.map(([k]) => <input key={k} type="hidden" name={`auto_${k}`} value={AU[k] ? 'on' : ''} />)}
        {own ? <button className="btn sm">Зачувај</button> : <p className="note">Само администраторот / главниот сметководител ги менува поставките.</p>}
      </ActionForm>
    </>
  );
}

