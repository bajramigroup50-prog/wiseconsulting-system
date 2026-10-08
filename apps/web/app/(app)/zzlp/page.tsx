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
import { closeGdpr, saveGdpr, saveZzChecklist } from './actions';

export default async function ZzlpPage() {
  const { u } = await officePage('zzlp', { perm: 'office' });
  const td = today();
  const [F, R, O] = await Promise.all([allowedFirms(u), db().select().from(gdprRecords).orderBy(desc(gdprRecords.date)), getOfficeProfile(db())]);
  const FL = await filesOf(OFFICE_FILE_ENTITY.gdpr, R.map((r) => r.id));
  const chk = O.zzlp?.chk ?? {};
  const dpa = new Set(R.filter((r) => r.kind === 'dpa' && r.firmId).map((r) => r.firmId));
  const noDpa = F.filter((f) => !dpa.has(f.id) && !(f.settings as { officeFirm?: boolean }).officeFirm);
  const fname = (id: string | null) => F.find((f) => f.id === id)?.name ?? '';
  return (
    <>
      <Hd t="🔐 Заштита на лични податоци (ЗЗЛП)" sub={`${R.length} записи · ${noDpa.length} клиенти без договор за обработка`} />
      <ActionForm action={saveZzChecklist} reset={false}>
        <h2>Обврски на канцеларијата</h2>
        {ZZ_CHK.map(([k, t]) => <label key={k} className="chk" style={{ display: 'block' }}><input type="checkbox" name={`chk_${k}`} defaultChecked={!!chk[k]} disabled={!can(u.principal, 'settings')} /> {t}</label>)}
        <h3 style={{ fontSize: 14, margin: '8px 0 4px' }}>Обработувачи (подизведувачи)</h3>
        <table className="dense"><tbody>{ZZ_SUB_DEF.map(([n, a, p, t]) => <tr key={n}><td><b>{n}</b><div className="mini">{a}</div></td><td>{p}</td><td className="mini">{t}</td></tr>)}</tbody></table>
        {can(u.principal, 'settings') && <div className="row"><button className="btn sm">Зачувај</button></div>}
      </ActionForm>

      <ActionForm action={saveGdpr}>
        <h2>+ Запис во регистарот</h2>
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
