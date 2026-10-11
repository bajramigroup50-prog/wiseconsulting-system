/** Legacy `VIEWS.osnovanje` **4004** — company formation cases (documents, founders, capital, ЦРСМ, bank). */
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { capitalSum, LEGAL_FORMS, NC_CHECK, NC_ST, NC_STATUS, NF, personName, type CapItem, type Founder, type NcStatus } from '@wise/core/office';
import { formationCases, officeTasks } from '@wise/db';
import { db } from '@/lib/db';
import { officePage } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { Hd, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { fmt } from '@/lib/fmt';
import { OwnTplLinks } from '@/components/own-tpl-links';
import { createFirmFromFormation, formationTask, saveFormation } from './actions';

/** Formation documents that can come from an own template (legacy `tplKinds` group „Основање на фирма“). */
const OSN_DOCS = ['Изјава за основање', 'Изјава по член 29 и 32 од ЗТД', 'Изјава по член 32 и 183 од ЗТД (управител)', 'Полномошно', 'Изјава (личен потпис)'];

export default async function OsnovanjePage({ searchParams }: { searchParams: Promise<{ id?: string; nov?: string }> }) {
  const sp = await searchParams;
  const { u } = await officePage('osnovanje', { perm: 'office' });
  const L = await db().select().from(formationCases).orderBy(desc(formationCases.updatedAt));
  const c = sp.id ? L.find((x) => x.id === sp.id) : undefined;
  const tasks = c ? await db().select().from(officeTasks).where(eq(officeTasks.formationId, c.id)) : [];
  const show = sp.nov !== undefined || !!c;
  const fo = [...(c?.founders ?? []), null, null, null].slice(0, 3) as (Founder | null)[];
  const cap = c ? capitalSum(c.capItems as CapItem[], Number(c.eurRate)) : null;
  return (
    <>
      <Hd t="Основање фирми" sub={`${L.filter((x) => x.status !== 'created').length} во тек`}><Link className="btn pri" href="/osnovanje?nov">+ Ново основање</Link></Hd>
      {show && (
        <ActionForm action={saveFormation} reset={false}>
          <div className="hd"><h2>{c ? c.name : 'Ново основање'}</h2>
            <div className="row">
              {c && <Pill c={NC_ST[c.status as NcStatus]?.[1]}>{NC_ST[c.status as NcStatus]?.[0]}</Pill>}
              <button className="btn pri">Зачувај</button>
              {c && <RowAction className="btn" action={formationTask.bind(null, c.id)} label="+ Задача за терен" />}
              {c && !c.firmId && ['registered', 'submitted'].includes(c.status) && can(u.principal, 'firms') && (
                <RowAction className="btn" action={createFirmFromFormation.bind(null, c.id)} label="➜ Внеси ја фирмата во програмата за сметководство" confirm="Да се креира фирма од ова основање?" />
              )}
              <Link className="btn" href="/osnovanje">Затвори</Link>
            </div></div>
          {c && <input type="hidden" name="id" value={c.id} />}
          <div className="form">
            <label className="f">Назив*<input name="name" defaultValue={c?.name ?? ''} required /></label>
            <label className="f">Правна форма<select name="form" defaultValue={c?.form ?? 'ДООЕЛ'}>{LEGAL_FORMS.map((x) => <option key={x}>{x}</option>)}</select></label>
            {c && <label className="f">Статус<select name="status" defaultValue={c.status}>{NC_STATUS.map((s) => <option key={s} value={s}>{NC_ST[s][0]}</option>)}</select></label>}
            {NF.filter(([k]) => k !== 'name' && k !== 'form').map(([k, l]) => (
              <label key={k} className={`f${k === 'notes' || k === 'activity' ? ' wide' : ''}`}>{l}<input name={`nf_${k}`} type={k === 'regDate' ? 'date' : undefined} defaultValue={c?.data[k] ?? ''} /></label>
            ))}
            <label className="f">Управител<input name="manager" defaultValue={(c?.managers[0] as { name?: string } | undefined)?.name ?? ''} /></label>
          </div>
          {cap && cap.eur > 0 && <p className="note">Основачки влог: {fmt(cap.eur)} EUR = {fmt(cap.mkd)} ден. (курс {Number(c?.eurRate ?? 0)})</p>}
          <h3 style={{ fontSize: 14, margin: '8px 0 4px' }}>Основачи</h3>
          <div className="tw"><table className="dense"><thead><tr><th>ФЛ/ПЛ</th><th>Име / назив</th><th>Презиме</th><th>ЕМБГ / ЕМБС</th><th>Бр. на лична карта / пасош</th><th>Адреса на живеење / седиште</th><th>Државјанство</th><th>Удел %</th></tr></thead><tbody>
            {fo.map((p, i) => (
              <tr key={i}>
                <td><select name={`fo${i}_kind`} defaultValue={p?.kind ?? 'ФЛ'}><option>ФЛ</option><option>ПЛ</option></select></td>
                <td><input name={`fo${i}_name`} defaultValue={p?.name ?? ''} /></td><td><input name={`fo${i}_surname`} defaultValue={p?.surname ?? ''} /></td>
                <td><input name={`fo${i}_embg`} defaultValue={p?.embg ?? ''} autoComplete="off" /></td><td><input name={`fo${i}_idNo`} defaultValue={p?.idNo ?? ''} autoComplete="off" style={{ width: 110 }} /></td><td><input name={`fo${i}_address`} defaultValue={p?.address ?? ''} /></td><td><input name={`fo${i}_cit`} defaultValue={p?.cit ?? ''} placeholder="Македонско" /></td>
                <td><input name={`fo${i}_share`} defaultValue={p?.share ?? ''} style={{ width: 70 }} /></td>
              </tr>
            ))}
          </tbody></table></div>
          <h3 style={{ fontSize: 14, margin: '8px 0 4px' }}>Проверка</h3>
          {NC_CHECK.map((t, i) => <label key={t} className="chk" style={{ display: 'block' }}><input type="checkbox" name={`chk${i}`} defaultChecked={!!c?.checklist[t]} /> {t}</label>)}
          {tasks.length > 0 && <p className="note">Задачи: {tasks.map((t) => `${t.title} (${t.status})`).join(', ')}</p>}
          {c && <div className="row" style={{ flexWrap: 'wrap', gap: 4, margin: '6px 0' }}><OwnTplLinks src={`osn:${c.id}`} docs={OSN_DOCS.map((t) => ({ k: `d:${t}`, label: t }))} /></div>}
          <p className="note">Документите за основање (изјава, полномошно, изјава на управител) се генерираат од <a href="/tpl">Шаблони</a> (група „Основање на фирма“): кога има прикачен сопствен шаблон, тука се појавуваат „📝 Word“ и „🖨 PDF“ пополнети со податоците од основањето.</p>
        </ActionForm>
      )}
      {L.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Назив</th><th>Форма</th><th>Основачи</th><th>Статус</th><th>Проверка</th><th>Изменето</th><th></th></tr></thead>
          <tbody>
            {L.map((x) => (
              <tr key={x.id}>
                <td><b>{x.name}</b></td><td>{x.form}</td><td>{(x.founders as unknown as Founder[]).map(personName).join(', ')}</td>
                <td><Pill c={NC_ST[x.status as NcStatus]?.[1]}>{NC_ST[x.status as NcStatus]?.[0] ?? x.status}</Pill></td>
                <td>{Object.values(x.checklist).filter(Boolean).length}/{NC_CHECK.length}</td>
                <td className="mini">{dmyHm(x.updatedAt)}</td>
                <td><Link className="btn sm" href={`/osnovanje?id=${x.id}`}>Отвори</Link></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <div className="card empty">Нема фирми во основање.</div>}
    </>
  );
}
