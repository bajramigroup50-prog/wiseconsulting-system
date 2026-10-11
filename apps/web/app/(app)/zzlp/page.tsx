/** Legacy `VIEWS.zzlp` **15490** — personal data protection (ЗЗЛП): office checklist, DPAs, statements, register. */
import { desc } from 'drizzle-orm';
import { can } from '@wise/core';
import { GDPR_KINDS, ZZ_CHK, ZZ_SUB_DEF, type GdprKind } from '@wise/core/office';
import { getOfficeProfile, gdprRecords, OFFICE_FILE_ENTITY } from '@wise/db';
import { db } from '@/lib/db';
import { allowedFirms, filesOf, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { FileChips, Pill } from '@/components/file-chips';
import { Hd, dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { OwnTplLinks } from '@/components/own-tpl-links';
import { closeGdpr, saveGdpr, saveZzChecklist, zzSigned } from './actions';
import { hrDocCodeNorm } from '@wise/core/payroll';
import { findDocCode } from './doc-verify';

export default async function ZzlpPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { u } = await officePage('zzlp', { perm: 'office' });
  const sp = await searchParams;
  // legacy `docVerify` 15598: the control code typed in „🔍 Провери контролен код на договор“
  const vCode = sp.code != null ? hrDocCodeNorm(sp.code) : undefined;
  const vHit = vCode ? await findDocCode(vCode) : null;
  const td = today();
  const [F, R, O] = await Promise.all([allowedFirms(u), db().select().from(gdprRecords).orderBy(desc(gdprRecords.date)), getOfficeProfile(db())]);
  const FL = await filesOf(OFFICE_FILE_ENTITY.gdpr, R.map((r) => r.id));
  const chk = O.zzlp?.chk ?? {};
  const dpa = new Set(R.filter((r) => r.kind === 'dpa' && r.firmId).map((r) => r.firmId));
  const noDpa = F.filter((f) => !dpa.has(f.id) && !(f.settings as { officeFirm?: boolean }).officeFirm);
  const fname = (id: string | null) => F.find((f) => f.id === id)?.name ?? '';
  // legacy: the module is the owner's only
  if (u.role !== 'admin') return <><Hd t="🔐 Лични податоци (ЗЗЛП)" exp={false} /><div className="card empty">🔒 Само сопственикот.</div></>;
  const C = F.filter((f) => !(f.settings as { officeFirm?: boolean }).officeFirm);
  const dpaOf = (id: string) => R.find((r) => r.kind === 'dpa' && r.firmId === id);
  const sg = C.filter((f) => dpa.has(f.id)).length;
  return (
    <>
      <Hd t="🔐 Лични податоци (ЗЗЛП)" sub="договори за обработка · изјави · УЈП" />
      <div className="callout">Сервер во <b>ЕУ</b> е дозволен без одобрение од Агенцијата (ЗЗЛП 42/2020 – пренос во земји членки на ЕУ/ЕЕП). Обработувачот (канцеларијата) мора да има <b>договор со секој клиент</b> (чл. 32) и <b>технички и организациски мерки</b> (чл. 36). Деловните книги мора <b>во секое време да се достапни во земјата</b> (чл. 47 ст. 3 ЗДП) – затоа дневна копија и во канцеларијата.{(!O.name || !O.edb) && <><br />⚠ Пополнете ги податоците на канцеларијата (Канцеларија → договори / податоци на канцеларијата) – се користат во документите.</>}</div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '6px 0 10px', alignItems: 'stretch' }}>
        {([['Клиенти', C.length], ['Потпишан договор', sg], ['Без договор', C.length - sg], ['Листа за проверка', `${ZZ_CHK.filter(([k]) => chk[k]).length} / ${ZZ_CHK.length}`]] as const).map(([l, v]) => (
          <div key={l} className="card" style={{ flex: 1, minWidth: 150, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div></div>
        ))}
      </div>
      <div className="card">
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>📄 Документи на канцеларијата</h2>
        <p className="note" style={{ margin: 0 }}>Барање за мислење до УЈП (чл. 47 ст. 3 ЗДП), Изјава за доверливост (вработен) и Договор за обработка на лични податоци се прават во Word / PDF од <a href="/tpl">📄 Шаблони</a>; изјавите на вработените се во <a href="/korisnici">👥 Корисници</a>.</p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 6 }}><OwnTplLinks src="firm:" docs={[{ k: 'd:Барање за мислење до УЈП', label: 'Барање за мислење до УЈП' }]} /></div>
        <form method="get" className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}><b style={{ minWidth: 260 }}>🔍 Провери контролен код на договор</b><input id="doc_code" name="code" defaultValue={sp.code ?? ''} placeholder="XXXX-XXXX-XXXX" style={{ width: 160, fontFamily: 'monospace' }} /><button className="btn sm">Провери</button></form>
        <div id="doc_vres">
          {vCode === null && <div className="callout warn">Внесете го кодот од 12 знаци (пр. 12AF-A639-949C).</div>}
          {vCode && (vHit
            ? <div className="callout good">✓ <b>Оригинален документ.</b> {vHit.t} · {vHit.name}{vHit.firm && vHit.firm !== vHit.name ? ' · ' + vHit.firm : ''}{vHit.no ? ' · бр. ' + vHit.no : ''}{vHit.date ? ' · ' + dmy(vHit.date) : ''}<br /><span className="mini">Зачуван {dmy(vHit.at.slice(0, 10))} од {vHit.by}</span></div>
            : <div className="callout bad">⚠ Кодот <b>{vCode}</b> не постои во програмата. Документот не е издаден од канцеларијата, или е изменет по зачувувањето (или не е зачуван во досие).</div>)}
        </div>
      </div>
      <div className="card tw" style={{ overflow: 'auto' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>🤝 Договор за обработка на лични податоци – по клиент</h2>
        {C.length ? <table className="dense">
          <thead><tr><th>Клиент</th><th>Управител</th><th>Датум</th><th>Статус</th><th>Документ</th><th></th></tr></thead>
          <tbody>{C.map((f) => {
            const d = dpaOf(f.id), s = f.settings as { signer?: string; manager?: string };
            return (
              <tr key={f.id}>
                <td><b>{f.name}</b><br /><span className="mini muted">ЕДБ {f.edb || '—'}</span></td>
                <td>{s.manager || s.signer || <span className="muted">—</span>}</td>
                <td>{d?.date ? dmy(d.date) : '—'}</td>
                <td>{d ? <span className="pill good">✓ потпишан {dmy(d.date)}</span> : <span className="pill warn">не е потпишан</span>}{(FL.get(d?.id ?? '')?.length ?? 0) > 0 && <span className="mini"> 📎</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}><OwnTplLinks src={`firm:${f.id}`} docs={[{ k: 'd:Договор за обработка на лични податоци' }]} none={<a className="btn sm" href="/tpl">📝 Word / 🖨 PDF</a>} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <RowAction action={zzSigned.bind(null, f.id, !d)} label={d ? '↺' : '✓ Потпишан'} className={`btn sm ${d ? '' : 'pri'}`} />
                  {' '}<a className="btn sm ghost" href="#zzNew" title="Прикачи го скенираниот потпишан договор – запис во регистарот со датотека">📎 Прикачи</a>
                </td>
              </tr>
            );
          })}</tbody>
        </table> : <div className="empty">Нема активни клиенти.</div>}
      </div>
      <ActionForm action={saveZzChecklist} reset={false}>
        <h2>Обврски на канцеларијата</h2>
        {ZZ_CHK.map(([k, t]) => <label key={k} className="chk" style={{ display: 'block' }}><input type="checkbox" name={`chk_${k}`} defaultChecked={!!chk[k]} disabled={!can(u.principal, 'settings')} /> {t}</label>)}
        <h3 style={{ fontSize: 14, margin: '8px 0 4px' }}>Обработувачи (подизведувачи)</h3>
        <table className="dense"><tbody>{ZZ_SUB_DEF.map(([n, a, p, t]) => <tr key={n}><td><b>{n}</b><div className="mini">{a}</div></td><td>{p}</td><td className="mini">{t}</td></tr>)}</tbody></table>
        {can(u.principal, 'settings') && <div className="row"><button className="btn sm">Зачувај</button></div>}
      </ActionForm>

      <ActionForm action={saveGdpr}>
        <h2 id="zzNew">+ Запис во регистарот</h2>
        <div className="form">
          <label className="f">Вид<select name="kind" defaultValue="dpa">{Object.entries(GDPR_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="f">Клиент (фирма)<select name="firmId" defaultValue=""><option value="">— канцеларија —</option>{F.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label className="f">Опис / лице<input name="subject" required /></label>
          <label className="f">Датум<input name="date" type="date" defaultValue={td} /></label>
          <label className="f">Важи до<input name="validTo" type="date" /></label>
          <label className="f wide">Белешка<input name="note" /></label>
          <UploadField firmId={null} label="📎 Потпишан документ" />
        </div>
        <div className="row"><button className="btn pri">Зачувај</button> <a className="btn ghost" href="/tpl">📄 Договор за обработка / Изјава за доверливост – Шаблони</a></div>
      </ActionForm>

      {noDpa.length > 0 && <div className="callout warn">Без договор за обработка на лични податоци: {noDpa.slice(0, 20).map((f) => f.name).join(', ')}{noDpa.length > 20 ? ` … (+${noDpa.length - 20})` : ''}</div>}

      <div className="tw"><table className="dense">
        <thead><tr><th>Датум</th><th>Вид</th><th>Клиент</th><th>Опис</th><th>Рок / важи до</th><th>Статус</th><th>Документ</th><th></th></tr></thead>
        <tbody>
          {R.map((r) => {
            const late = r.status === 'open' && r.due && r.due < td;
            return (
              <tr key={r.id}>
                <td>{dmy(r.date)}</td><td>{GDPR_KINDS[r.kind as GdprKind] ?? r.kind}</td><td>{fname(r.firmId)}</td><td>{r.subject}</td>
                <td style={late ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{dmy(r.due ?? r.validTo)}</td>
                <td><Pill c={r.status === 'open' ? 'warn' : 'good'}>{r.status === 'open' ? 'отворено' : r.status === 'closed' ? 'затворено' : 'потпишано'}</Pill></td>
                <td><FileChips files={FL.get(r.id)} /></td>
                <td>{r.status === 'open' && <RowAction action={closeGdpr.bind(null, r.id)} label="✓ Затвори" />}</td>
              </tr>
            );
          })}
          {!R.length && <tr><td colSpan={8} className="mut">Регистарот е празен.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
