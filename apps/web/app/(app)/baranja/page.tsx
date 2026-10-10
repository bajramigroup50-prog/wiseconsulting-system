/**
 * Legacy `VIEWS.baranja` (3974 + 15094) — Барања и обрасци: requests to institutions and official forms filled
 * automatically with the firm's data (name, ЕДБ, ЕМБС, address, manager, account, date); fields that differ each time
 * are asked before printing; own templates can be added / edited (built-in samples can be overridden).
 * Gaps: „📋 Задача за терен со овој документ“, firms in formation as the source, the firm's signature image on forms.
 */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { FORMS0, INST, TPL0, askFields, type ReqFirm, type ReqForm, type ReqTpl } from '@wise/core/firms/requests';
import { requestTemplates, type Firm } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { deleteTemplate, saveTemplate } from './actions';
import { GenPanel } from './gen-panel';

const reqFirm = (f: Firm): ReqFirm => {
  const s = (f.settings ?? {}) as Record<string, string | undefined>;
  return {
    name: f.name, short: s.short, edb: f.edb ?? '', embs: f.embs ?? '', address: f.address ?? '', city: f.city ?? '', bank: s.bankAccount ?? s.bank, bankName: s.bankName,
    signer: s.signer ?? s.manager, phone: f.phone ?? '', email: f.email ?? '', activity: f.activity ?? '', nkd: s.nkd, signerEmbg: s.signerEmbg,
  };
};

export default async function BaranjaPage({ searchParams }: { searchParams: Promise<{ t?: string; src?: string; edit?: string }> }) {
  const { u, firm } = await officePage('baranja');
  const sp = await searchParams;
  const U = await db().select().from(requestTemplates).orderBy(asc(requestTemplates.name));
  const own = U.map((x): ReqTpl & { dbId: string; baseId: string | null } => ({ id: x.id, dbId: x.id, baseId: x.baseId, inst: x.inst, name: x.name, to: x.to ?? undefined, title: x.title, body: x.body }));
  const overridden = new Set(own.map((x) => x.baseId).filter(Boolean));
  const T: (ReqTpl | ReqForm)[] = [...FORMS0, ...TPL0.filter((b) => !overridden.has(b.id)), ...own];
  const office = can(u.principal, 'office');
  const F = await allowedFirms(u);
  const src = F.find((x) => x.id === sp.src) ?? firm ?? F[0];
  const tp = sp.t ? T.find((x) => x.id === sp.t) : undefined;
  const ed = sp.edit !== undefined && office ? (sp.edit ? T.find((x) => x.id === sp.edit && !('form' in x)) as (ReqTpl & { dbId?: string }) | undefined : null) : undefined;

  if (ed !== undefined) {
    const d = ed ?? { id: '', inst: 'УЈП', name: '', title: '', body: '' };
    return (
      <>
        <Hd t={d.id ? 'Измена на образец' : 'Нов образец'}><Link className="btn" href="/baranja">Откажи</Link></Hd>
        <ActionForm action={saveTemplate} reset={false}>
          {'dbId' in d && d.dbId ? <input type="hidden" name="id" value={d.dbId} /> : d.id && <input type="hidden" name="baseId" value={d.id} />}
          <div className="form">
            <label className="f wide">Назив на образецот<input name="name" defaultValue={d.name} required /></label>
            <label className="f">Институција<select name="inst" defaultValue={d.inst}>{INST.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="f wide">До (примач)<input name="to" defaultValue={d.to ?? ''} placeholder="на пр. Управа за јавни приходи – РО Скопје" /></label>
            <label className="f wide">Наслов<textarea name="title" rows={2} defaultValue={d.title} /></label>
            <label className="f wide">Текст<textarea name="body" rows={12} defaultValue={d.body} /></label>
          </div>
          <p className="note">Автоматски полиња: {'{фирма} {скратен} {едб} {ембс} {адреса} {град} {жиро} {банка} {управител} {телефон} {email} {датум}'}.<br />Поле што се внесува секој пат: <code>{'{?Опис на полето}'}</code>, на пр. <code>{'{?Намена}'}</code>.</p>
          <button className="btn pri">Зачувај</button>
        </ActionForm>
      </>
    );
  }

  return (
    <>
      <Hd t="Барања и обрасци" sub="се пополнуваат автоматски со податоците на фирмата">
        {office && <Link className="btn pri" href="/baranja?edit">+ Нов образец</Link>}
      </Hd>
      <div className="callout" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>🏢 <b>Основање нова фирма</b> – изјава / договор за основање, одлука за управител, изјава за влогот, во Word за потпис.<span style={{ flex: 1 }} /><Link className="btn sm" href="/osnovanje">Сите во основање</Link></div>
      <div className="callout">Изберете образец и фирма – назив, ЕДБ, ЕМБС, адреса, управител, жиро сметка и датум се пополнуваат сами. Полињата што се различни секој пат (на пр. намена) ги внесувате пред печатење.</div>
      <div className="tw"><table className="dense">
        <thead><tr><th>Институција</th><th>Образец</th><th>Полиња за внес</th><th /></tr></thead>
        <tbody>
          {T.map((t) => {
            const isF = 'form' in t;
            const isOwn = own.some((x) => x.id === t.id);
            return (
              <tr key={t.id}>
                <td><span className="pill">{t.inst}</span></td>
                <td><b>{t.name}</b>{isF ? <> <span className="pill good">официјален образец</span></> : !isOwn && <span className="mini"> (пример)</span>}</td>
                <td className="mini">{isF ? (t as ReqForm).fields.filter((x) => x.t === 't' && x.src.startsWith('f.')).length + ' полиња од фирмата' : (t as ReqTpl).free ? 'слободен текст' : askFields((t as ReqTpl).title + ' ' + (t as ReqTpl).body).join(', ') || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link className="btn sm pri" href={`/baranja?t=${encodeURIComponent(t.id)}${src ? '&src=' + src.id : ''}`}>Пополни</Link>
                  {!isF && office && <> <Link className="btn sm" href={`/baranja?edit=${encodeURIComponent(t.id)}`}>✎</Link></>}
                  {isOwn && office && <> <RowAction action={deleteTemplate.bind(null, t.id)} label="🗑" style={{ color: 'var(--bad)' }} confirm={`Да се избрише образецот „${t.name}“?`} /></>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {tp && src && <GenPanel key={tp.id + src.id} tp={tp} firm={reqFirm(src)} firmId={src.id} firms={F.map((x) => ({ id: x.id, name: x.name }))} today={today()} />}
      {tp && !src && <div className="callout warn">Нема фирми за пополнување.</div>}
    </>
  );
}
