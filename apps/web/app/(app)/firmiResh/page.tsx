/**
 * Legacy `VIEWS.firmiResh` (10540) — Нова фирма од решение: scan the registration decision (ЦРМ / УЈП), the AI reads
 * it (worker job `ai.read-firm-resh`), the user checks the data and the firm is created (or an existing one completed).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { can, YE_ENTITY_NAMES, YE_LEGAL_FORMS, YE_LF_ENT } from '@wise/core';
import { nkdProfiles, profileName, suggestedModules } from '@wise/core/industry';
import { FS_CAT, fsDup, type ReshData } from '@wise/core/firms/resh';
import { firmReshReads, firms } from '@wise/db';
import { db } from '@/lib/db';
import { officePage } from '@/lib/office';
import { Hd } from '@/components/hd';
import { Poll, ReviewForm, StartForm } from './forms';

const EMPTY: ReshData = { docType: 'upis', docNumber: '', docDate: '', name: '', short: '', lf: '', embs: '', edb: '', address: '', city: '', nkd: '', otherNkd: [], activity: '', regDate: '', capital: 0, capitalCur: '', signer: '', founders: [], bank: '', bankName: '', vatFrom: '', ddv: false, phone: '', email: '' };

export default async function FirmiReshPage({ searchParams }: { searchParams: Promise<{ r?: string; man?: string }> }) {
  const { u } = await officePage('firmiResh');
  if (!can(u.principal, 'firms')) notFound();
  const sp = await searchParams;
  const [read] = sp.r && /^[0-9a-f-]{36}$/i.test(sp.r) ? await db().select().from(firmReshReads).where(eq(firmReshReads.id, sp.r)).limit(1) : [];
  const busy = !!read && (read.status === 'queued' || read.status === 'reading');
  const r: ReshData | null = read?.status === 'done' ? { ...EMPTY, ...(read.result as ReshData) } : sp.man !== undefined || read?.status === 'error' ? EMPTY : null;
  const dup = r && r.name ? fsDup(r, await db().select({ id: firms.id, name: firms.name, edb: firms.edb, embs: firms.embs }).from(firms)) : undefined;
  const lfOpts = YE_LEGAL_FORMS.flatMap(([g, L]) => L.map(([k, n]) => [k, g + ' – ' + n] as const));
  const I = (k: keyof ReshData, l: string, o: { wide?: boolean; date?: boolean } = {}) => (
    <label className="f" style={o.wide ? { gridColumn: '1/-1' } : undefined}>{l}<input name={k} type={o.date ? 'date' : 'text'} defaultValue={String(r?.[k] ?? '')} /></label>
  );
  const prof = r ? nkdProfiles(r.nkd) : [];
  return (
    <>
      <Hd t="Нова фирма од решение" sub="Скенирајте го решението од ЦРМ (или тековна состојба / решение од УЈП) – програмата сама ја отвора фирмата">
        <Link className="btn" href="/firmi">← Фирми</Link>
        {!r && <Link className="btn" href="/firmiResh?man">✎ Рачно</Link>}
      </Hd>
      {!read && <StartForm />}
      <Poll active={busy} />
      {busy && <div className="callout">⏳ Се чита решението…</div>}
      {read?.status === 'error' && <div className="callout warn">Не успеа читањето: {read.error} – обидете се со појасна слика или PDF, или пополнете рачно.</div>}
      {read?.status === 'saved' && <div className="callout good">Ова решение е веќе внесено. <Link href="/firmiResh">+ Следна фирма</Link></div>}
      {r && read?.status !== 'saved' && (
        <ReviewForm readId={read?.id ?? ''} exId={dup?.id ?? ''}>
          <div className="hd"><h2 style={{ fontSize: 16 }}>{read ? 'Прочитано од решението – проверете пред внесување' : 'Податоци од решението'}</h2>{read && <span className="pill info">{FS_CAT[r.docType] ?? 'Решение'}</span>}</div>
          {read && !r.name && <div className="callout warn">Не се најде назив – проверете дали е добро скенирано или пополнете рачно.</div>}
          {dup && <div className="callout warn">⚠ Веќе постои фирма „<b>{dup.name}</b>“ (ЕДБ {dup.edb || '—'}, ЕМБС {dup.embs || '—'}). Нема да се креира двапати – со „Дополни постоечка“ решението се зачувува во нејзиното досие и се пополнуваат само празните полиња.</div>}
          <div className="form">
            {I('name', 'Назив (целосен)', { wide: true })}{I('short', 'Кратко име')}
            <label className="f">Правна форма / вид<select name="lf" defaultValue={r.lf}><option value="">— изберете —</option>{lfOpts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            {I('embs', 'Матичен број (ЕМБС)')}{I('edb', 'Даночен број (ЕДБ)')}{I('address', 'Адреса')}{I('city', 'Град')}
            {I('nkd', 'Шифра на дејност (НКД)')}{I('activity', 'Дејност (опис)')}{I('signer', 'Управител / застапник')}{I('regDate', 'Датум на основање', { date: true })}
            {I('bank', 'Жиро сметка')}{I('bankName', 'Банка')}{I('phone', 'Телефон')}{I('email', 'Е-пошта')}
            {I('docNumber', 'Број на решението')}{I('docDate', 'Датум на решението', { date: true })}
            <label className="f">ДДВ обврзник<select name="ddv" defaultValue={r.ddv ? '1' : '0'}><option value="0">Не (уште не)</option><option value="1">Да</option></select></label>
            {I('vatFrom', 'ДДВ од датум', { date: true })}
          </div>
          {r.founders.length > 0 && <p className="mini" style={{ margin: '8px 0 0' }}>Основачи: {r.founders.map((x) => x.name + (x.share ? ` (${x.share})` : '')).join(', ')}{r.capital ? ` · главнина ${r.capital.toLocaleString('mk-MK')} ${r.capitalCur || 'ден.'}` : ''}</p>}
          <p className="mini" style={{ margin: '6px 0 0' }}>Модули што ќе се вклучат автоматски според шифрата: <b>{suggestedModules(prof).join(', ') || 'само основни'}</b>{prof.length ? ` (${prof.map(profileName).join(', ')})` : ''} · Завршна сметка: <b>{YE_ENTITY_NAMES[YE_LF_ENT[r.lf] ?? 'co']}</b></p>
          <div className="row" style={{ gap: '6px 18px', flexWrap: 'wrap', marginTop: 10 }}>
            {can(u.principal, 'users') && <label className="chk" style={{ margin: 0 }}><input type="checkbox" name="kl" defaultChecked /> креирај профил за клиентот (корисник + лозинка)</label>}
            <label className="chk" style={{ margin: 0 }}><input type="checkbox" name="open" defaultChecked /> избери ја фирмата по внесувањето</label>
          </div>
        </ReviewForm>
      )}
    </>
  );
}
