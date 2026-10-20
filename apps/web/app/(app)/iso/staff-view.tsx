/**
 * 👥 Вработени (ISO/IEC 27001 A.6, A.5.11, A.5.15–5.18, ЗЗЛП чл. 36): per colleague of the office's own firm – the
 * employment contract with the security / ЗЗЛП articles (edited in Вработени → Договор, printed here for signing,
 * „✓ Потпишан“ with the scan), the confidentiality statement, the accepted policies with their versions, trainings,
 * access and assets on joining / leaving. The ethics / independence declaration is in the ISQM module (/ifac).
 */
import Link from 'next/link';
import { policiesInForce, type StaffCheck } from '@wise/core/office/iso-staff';
import { ActionForm, Submit } from '@/components/action-form';
import { FileChips } from '@/components/file-chips';
import { FirmGo } from '@/components/firm-go';
import { dmy } from '@/components/hd';
import { UploadField } from '@/components/upload-field';
import { staffSave } from './actions';
import type { IsoRowX, StaffLine } from './iso-data';

const C: Record<StaffCheck, [string, string]> = { ok: ['✓', 'good'], part: ['◐', 'warn'], miss: ['✗', 'bad'], na: ['–', ''] };
const P = ({ c, children }: { c: StaffCheck; children?: React.ReactNode }) => <><span className={`pill ${C[c][1]}`}>{C[c][0]}</span>{children ? <div className="mini">{children}</div> : null}</>;

export function StaffView({ office, lines, R }: { office: { id: string; name: string } | null; lines: StaffLine[]; R: readonly IsoRowX[] }) {
  if (!office) return <div className="card"><div className="callout warn">Означете ја фирмата на канцеларијата (Фирми → „фирма на канцеларијата“) – вработените на канцеларијата се водат во нејзините Вработени.</div></div>;
  const pol = policiesInForce(R);
  const ok = lines.filter((l) => l.s.ok).length;
  return (
    <div className="card">
      <div className="hd"><h2 style={{ margin: 0 }}>👥 Вработени – безбедност на човечките ресурси (A.6)</h2>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <a className="btn" href="/print/iso/dogovor?all=1" target="_blank" rel="noreferrer">🖨 Печати ги сите договори</a>
          <a className="btn" href="/print/iso/politiki?all=1" target="_blank" rel="noreferrer">🖨 Изјави за политиките – сите</a>
        </div></div>
      <p className="note" style={{ marginTop: 4 }}>
        Вработените на <b>{office.name}</b> ({ok} / {lines.length} целосно). Договорот за вработување се уредува во <b>Вработени → Договор</b> (одредбите за доверливост, безбедност на информациите, овластено лице по ЗЗЛП, средства, инциденти, политики и обуки, етика и дисциплински мерки се членови на самиот договор); печатете го, потпишете го во 2 примероци и означете „✓ Потпишан“ со скенот.
        Изјавата за прифаќање на политиките ги наведува документите во сила ({pol.length}) со верзијата – потпишува се повторно кога ќе се смени политика. Етика и независност (IESBA): <Link href="/ifac">⚖ ISQM 1 / IESBA</Link>.
      </p>
      {!lines.length ? <div className="empty">Нема вработени во фирмата на канцеларијата.</div> : (
        <div className="tw"><table className="dense">
          <thead><tr><th>Вработен</th><th>Договор (A.6.2, A.6.6)</th><th>Доверливост</th><th>Политики (A.6.3)</th><th>Обуки</th><th>Пристап / средства</th><th /></tr></thead>
          <tbody>{lines.map((l) => {
            const d = l.row?.data ?? {};
            return (
              <tr key={l.emp.id} style={{ verticalAlign: 'top' }}>
                <td><b>{l.emp.name}</b><div className="mini">{l.emp.position ?? ''}{l.emp.start ? ` · од ${dmy(l.emp.start)}` : ''}{!l.emp.active && l.emp.end ? ` · заминал ${dmy(l.emp.end)}` : ''}</div>
                  {l.s.ok ? <span className="pill good">✓ подготвен</span> : l.s.notes.length ? <div className="mini" style={{ color: 'var(--warn)' }}>{l.s.notes.join(' · ')}</div> : null}</td>
                <td><P c={l.s.contract}>{l.contract ? <>бр. {l.contract.no}{l.contract.signDate ? ` од ${dmy(l.contract.signDate)}` : ''}{l.contract.iso ? ' · со ISO / ЗЗЛП' : ' · без ISO одредби'}</> : 'не е заведен'}{d.contractOn ? <><br />потпишан {dmy(String(d.contractOn))}</> : null}</P>
                  <FileChips files={l.files} /></td>
                <td><P c={l.s.confid}>{l.s.confid === 'ok' ? 'договор / изјава' : 'нема'}</P></td>
                <td><P c={l.s.policies}>{d.ackOn ? `прифатени ${dmy(String(d.ackOn))}` : 'не се прифатени'}{l.s.missing.length && d.ackOn ? <><br />нови: {l.s.missing.map((p) => `${p.docNo} в${p.version}`).join(', ')}</> : null}</P></td>
                <td><P c={l.s.training}>{l.s.trainedOn ? `последна ${dmy(l.s.trainedOn)} · ${l.s.hours} ч.` : 'нема'}</P></td>
                <td><P c={l.s.access}>{l.user ? `${l.user.role}${l.user.active ? '' : ' · затворен'}` : 'нема корисник'}{d.offboardOn ? <><br />престанок {dmy(String(d.offboardOn))}{d.accessOffOn ? `, пристап затворен ${dmy(String(d.accessOffOn))}` : ''}</> : null}</P></td>
                <td style={{ minWidth: 220 }}>
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    <a className="btn sm" href={`/print/iso/dogovor?e=${l.emp.id}`} target="_blank" rel="noreferrer">🖨 Договор</a>
                    <a className="btn sm" href={`/print/iso/politiki?e=${l.emp.id}`} target="_blank" rel="noreferrer">🖨 Изјава за политики</a>
                    {l.user && <a className="btn sm" href={`/print/izjava?u=${l.user.id}`} target="_blank" rel="noreferrer" title="Изјава за доверливост (ЗЗЛП)">📄 Доверливост</a>}
                    <FirmGo fid={office.id} to={`/vraboteni/${l.emp.id}/dogovor`} className="btn sm" title="Уреди и заведи го договорот (фирма на канцеларијата)">✎ Договор</FirmGo>
                  </div>
                  <details style={{ marginTop: 4 }}><summary className="mini">✓ Потпишан · политики · пристап</summary>
                    <ActionForm action={staffSave} reset={false}>
                      <input type="hidden" name="employeeId" value={l.emp.id} /><input type="hidden" name="op" value="contract" />
                      {l.files.length > 0 && <input type="hidden" name="hasFile" value="1" />}
                      <label className="f">Договорот потпишан на<input type="date" name="contractOn" defaultValue={String(d.contractOn ?? '')} /></label>
                      <UploadField firmId={null} label="📎 Скен на потпишаниот договор" />
                      <Submit>✓ Потпишан</Submit>
                    </ActionForm>
                    <ActionForm action={staffSave} reset={false}>
                      <input type="hidden" name="employeeId" value={l.emp.id} /><input type="hidden" name="op" value="ack" />
                      <label className="f">Изјавата потпишана на<input type="date" name="ackOn" defaultValue={String(d.ackOn ?? '')} /></label>
                      <UploadField firmId={null} label="📎 Скен на изјавата" />
                      <Submit>✓ Ги прифати важечките политики</Submit>
                    </ActionForm>
                    <ActionForm action={staffSave} reset={false}>
                      <input type="hidden" name="employeeId" value={l.emp.id} /><input type="hidden" name="op" value="access" />
                      <label className="f">Пристапот отворен на<input type="date" name="onboardOn" defaultValue={String(d.onboardOn ?? '')} /></label>
                      <label className="f">Задолжени средства<input name="assetsOut" defaultValue={String(d.assetsOut ?? '')} placeholder="лаптоп, клуч…" /></label>
                      <label className="f">Престанок на работа<input type="date" name="offboardOn" defaultValue={String(d.offboardOn ?? '')} /></label>
                      <label className="f">Средствата вратени<select name="assetsBack" defaultValue={String(d.assetsBack ?? '')}>{['', 'да', 'делумно', 'не'].map((o) => <option key={o} value={o}>{o || '—'}</option>)}</select></label>
                      <label className="f">Пристапот затворен на<input type="date" name="accessOffOn" defaultValue={String(d.accessOffOn ?? '')} /></label>
                      <Submit>Зачувај</Submit>
                    </ActionForm>
                  </details>
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}
