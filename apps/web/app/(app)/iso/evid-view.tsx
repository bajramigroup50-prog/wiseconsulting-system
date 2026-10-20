/**
 * 🗂 Регистар на задолжителни евиденции и документи: every book, register and record the standards and the law require,
 * with code, basis, responsible person, where it is kept, архивски знак and keeping period, last update and status;
 * „✓ Ажурирано“ (date, note, file) for what the program does not keep itself; the forms (ОБР) with their procedure.
 */
import Link from 'next/link';
import { ARCH_CATEGORIES, archKeepLabel } from '@wise/core/office/archive';
import { ISO_CODE_CLASSES, ISO_FORMS } from '@wise/core/office/iso-docs';
import { REG_STATE, REG_STD_ORDER, REG_STDS, type RegRow } from '@wise/core/office/iso-registry';
import { ActionForm, Submit } from '@/components/action-form';
import { FileChips } from '@/components/file-chips';
import { dmy } from '@/components/hd';
import { UploadField } from '@/components/upload-field';
import { evidSave } from './actions';

export function EvidView({ L, users, files, owners }: { L: RegRow[]; users: { id: string; name: string }[]; files: Map<string, { id: string; name: string }[]>; owners: Map<string, string | null> }) {
  const n = { ok: L.filter((r) => r.state === 'ok').length, old: L.filter((r) => r.state === 'old').length, miss: L.filter((r) => r.state === 'miss').length };
  const uName = (id: string | null | undefined) => users.find((u) => u.id === id)?.name;
  return (
    <div className="card">
      <div className="hd"><h2 style={{ margin: 0 }}>🗂 Регистар на задолжителни евиденции и документи</h2>
        <div className="row" style={{ gap: 6 }}><a className="btn" href="/print/iso/obr?f=REG" target="_blank" rel="noreferrer">🖨 Печати го регистарот</a></div></div>
      <p className="note" style={{ marginTop: 4 }}>Сите книги, регистри и записи што ги бараат стандардите и законите (работодавач, сметководствена канцеларија, АМЛ, архива): каде се чуваат, кој е одговорен, архивскиот знак и рокот на чување, последното ажурирање. Каде програмата ги води сама – состојбата се пресметува; за останатите „✓ Ажурирано“ со датум и прилог (скен), а хартиените обрасци се печатат празни.
        Ознаки: {Object.entries(ISO_CODE_CLASSES).map(([k, v]) => `${k} – ${v}`).join(' · ')}.</p>
      <div className="row" style={{ gap: 8, margin: '4px 0 8px' }}><span className="pill good">✓ {n.ok}</span><span className="pill warn">◐ застарено {n.old}</span><span className="pill bad">✗ недостасува {n.miss}</span></div>
      {REG_STD_ORDER.map((s) => (
        <div key={s} style={{ marginTop: 10 }}>
          <h3 style={{ margin: '0 0 4px' }}>{REG_STDS[s]}</h3>
          <div className="tw"><table className="dense">
            <thead><tr><th>Ознака</th><th>Евиденција / документ</th><th>Основ</th><th>Одговорен</th><th>Каде се чува</th><th>Арх. знак · рок</th><th>Последно</th><th>Состојба</th><th /></tr></thead>
            <tbody>{L.filter((r) => r.std === s).map((r) => (
              <tr key={r.id} id={r.id} style={{ verticalAlign: 'top' }}>
                <td style={{ whiteSpace: 'nowrap' }}><b>{r.code}</b></td>
                <td>{r.n}{r.form ? <div className="mini"><a href={ISO_FORMS.find((f) => f.code === r.form)?.print ?? '#'} target="_blank" rel="noreferrer">🖨 {r.form}</a></div> : null}</td>
                <td className="mini">{r.basis}</td>
                <td className="mini">{uName(owners.get(r.id)) ?? r.owner}</td>
                <td className="mini"><Link href={r.href}>{r.where}</Link></td>
                <td className="mini" style={{ whiteSpace: 'nowrap' }}>{r.sign} · {r.retention}</td>
                <td className="mini">{r.last ? dmy(r.last) : '—'}</td>
                <td><span className={`pill ${REG_STATE[r.state][1]}`}>{REG_STATE[r.state][0]}</span>{r.note ? <div className="mini">{r.note}</div> : null}{r.state !== 'ok' && r.note !== r.todo ? <div className="mini" style={{ color: 'var(--muted)' }}>→ {r.todo}</div> : null}</td>
                <td style={{ minWidth: 160 }}>
                  {r.manual ? (
                    <details><summary className="mini">✓ Ажурирано</summary>
                      <ActionForm action={evidSave} reset={false}>
                        <input type="hidden" name="row" value={r.id} />
                        <label className="f">Последно ажурирање<input type="date" name="lastOn" defaultValue={r.last ?? ''} /></label>
                        <label className="f">Одговорен<select name="ownerId" defaultValue={owners.get(r.id) ?? ''}><option value="">{r.owner}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                        <label className="f">Белешка<input name="note" defaultValue={r.note && r.note !== r.todo ? r.note : ''} /></label>
                        <UploadField firmId={null} label="📎 Прилог (скен)" />
                        <Submit>Зачувај</Submit>
                      </ActionForm>
                      {r.evidId && <FileChips files={files.get(r.evidId)} />}
                    </details>
                  ) : <Link className="btn sm" href={r.href}>Отвори</Link>}
                  {r.manual && r.evidId && (files.get(r.evidId)?.length ?? 0) > 0 && <div className="mini">📎 {files.get(r.evidId)!.length}</div>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}

      <h3 style={{ margin: '16px 0 4px' }} id="obr">Обрасци (ОБР) – која постапка ги користи</h3>
      <div className="tw"><table className="dense">
        <thead><tr><th>Ознака</th><th>Верзија</th><th>Образец</th><th>Постапка</th><th>Основ</th><th /></tr></thead>
        <tbody>{ISO_FORMS.map((f) => <tr key={f.code}><td><b>{f.code}</b></td><td>{f.v}</td><td>{f.n}</td><td>{f.proc}</td><td className="mini">{f.basis}</td><td><a className="btn sm" href={f.print} target="_blank" rel="noreferrer">🖨 Печати</a></td></tr>)}</tbody>
      </table></div>

      <h3 style={{ margin: '16px 0 4px' }}>Листа на категории на документарен материјал (архивски знаци)</h3>
      <p className="note">Секој документ во деловодникот (Архива) го добива архивскиот знак на својата категорија и рокот на чување. Листата ја одобрува Државниот архив – <a href="/print/iso/obr?f=ОБР-12" target="_blank" rel="noreferrer">🖨 ОБР-12 за одобрување</a>.</p>
      <div className="tw"><table className="dense">
        <thead><tr><th>Знак</th><th>Категорија</th><th>Рок на чување</th><th>Основ</th></tr></thead>
        <tbody>{ARCH_CATEGORIES.map((c) => <tr key={c.sign}><td><b>{c.sign}</b></td><td>{c.n}</td><td>{archKeepLabel(c)}</td><td className="mini">{c.basis}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
