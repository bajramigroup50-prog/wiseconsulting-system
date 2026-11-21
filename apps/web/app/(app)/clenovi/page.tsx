/**
 * „🧑‍🤝‍🧑 Регистар на членови“ (module `meals`, associations) — Закон за здруженија и фондации: the association keeps a
 * register of its members and of the members of its organs and updates it at least every 2 years. Members with
 * organ / function, joined / left, contact; the „last updated“ date with a warning when it is older than 2 years (also
 * a deadline in 📅 Рокови); print / PDF / Excel and the Excel import. The association's own user sees it in the portal.
 */
import Link from 'next/link';
import { memberActive, membersDue, membersState, NPO_ORGANS, NPO_ROLES } from '@wise/core/npo';
import { listMembers, membersLastUpdate } from '@wise/db';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { PdfButton } from '@/components/pdf-button';
import { RowAction } from '@/components/row-action';
import { XlsxButton } from '@/components/vp-tools';
import { deleteMemberAction, importMembersAction, reviewMembersAction, saveMemberAction } from './actions';

const T = 'Регистар на членови';
const HEAD = ['Име и презиме', 'ЕМБГ', 'Адреса', 'Телефон', 'Е-пошта', 'Зачленет', 'Исчленет', 'Орган', 'Функција', 'Забелешка'];

export default async function Clenovi({ searchParams }: { searchParams: Promise<{ id?: string; nov?: string; all?: string; o?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('clenovi', T);
  if (g.blocked) return g.blocked;
  const { firm, write } = g;
  const td = today();
  const [M, LU] = await Promise.all([listMembers(db(), firm.id), membersLastUpdate(db(), [firm.id])]);
  const last = LU.get(firm.id) ?? null;
  const st = membersState(last, td);
  const due = membersDue(last);
  const act = M.filter((m) => memberActive(m, td));
  const rows = (sp.all === '1' ? M : act).filter((m) => !sp.o || (m.organ ?? '') === sp.o)
    .sort((a, b) => (NPO_ORGANS.indexOf(a.organ ?? '') + 99) % 99 - (NPO_ORGANS.indexOf(b.organ ?? '') + 99) % 99 || a.name.localeCompare(b.name, 'mk'));
  const E = sp.id ? M.find((m) => m.id === sp.id) : null;
  const showForm = write && (!!E || sp.nov === '1');
  const organs = [...new Set([...NPO_ORGANS, ...M.map((m) => m.organ).filter((x): x is string => !!x)])];
  const byOrgan = organs.map((o) => [o, act.filter((m) => m.organ === o).length] as const).filter(([, n]) => n);
  return (
    <>
      <Hd t={'🧑‍🤝‍🧑 ' + T} sub={`${firm.name} · членови и членови на органите`} exp={false} excel={false}>
        {write && <Link className="btn pri" href="/clenovi?nov=1">+ Нов член</Link>}
        {sp.all === '1' ? <Link className="btn" href="/clenovi">Само сегашни</Link> : <Link className="btn" href="/clenovi?all=1">И исчленети</Link>}
        <PdfButton selector="#clenReg" title={`Регистар на членови – ${firm.name}`} landscape />
        <XlsxButton name={`registar-clenovi-${td}`} sheets={[{ name: 'Членови', rows: [HEAD, ...rows.map((m) => [m.name, m.embg ?? '', m.address ?? '', m.phone ?? '', m.email ?? '', m.joined ? dmy(m.joined) : '', m.left ? dmy(m.left) : '', m.organ ?? '', m.role ?? '', m.note ?? ''])] }]} />
        <Link className="btn" href="/obroci">🍲 Корисници и оброци</Link>
      </Hd>

      <div className={'callout ' + (st === 'ok' ? 'good' : st === 'soon' ? 'warn' : 'bad')} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>
          {st === 'never' ? 'Регистарот уште не е ажуриран. ' : `Последно ажурирање: ${dmy(last!)}. `}
          {st === 'late' && <b>⚠ Постар е од 2 години – ажурирајте го (Закон за здруженија и фондации). </b>}
          {st === 'soon' && <b>Рокот за ажурирање истекува на {dmy(due!)}. </b>}
          {st === 'ok' && `Следно ажурирање најдоцна до ${dmy(due!)}.`}
        </span>
        {write && <BankForm action={reviewMembersAction} confirm="Да се означи дека регистарот е прегледан и ажуриран денес?"><button className="btn sm">✓ Регистарот е прегледан и ажуриран денес</button></BankForm>}
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
        <Link className={'pill' + (!sp.o ? ' good' : '')} href={`/clenovi${sp.all === '1' ? '?all=1' : ''}`}>Сите: <b>{act.length}</b></Link>
        {byOrgan.map(([o, n]) => <Link key={o} className={'pill' + (sp.o === o ? ' good' : '')} href={`/clenovi?o=${encodeURIComponent(o)}${sp.all === '1' ? '&all=1' : ''}`}>{o}: <b>{n}</b></Link>)}
      </div>

      {showForm && (
        <div className="card">
          <h2 style={{ margin: '0 0 6px' }}>{E ? `✎ ${E.name}` : '+ Нов член'}</h2>
          <BankForm action={saveMemberAction}>
            <input type="hidden" name="id" value={E?.id ?? ''} />
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="f" style={{ minWidth: 220 }}>Име и презиме<input name="name" required defaultValue={E?.name ?? ''} /></label>
              <label className="f">ЕМБГ (по избор)<input name="embg" defaultValue={E?.embg ?? ''} inputMode="numeric" maxLength={13} /></label>
              <label className="f" style={{ minWidth: 220 }}>Адреса<input name="address" defaultValue={E?.address ?? ''} /></label>
              <label className="f">Телефон<input name="phone" defaultValue={E?.phone ?? ''} /></label>
              <label className="f">Е-пошта<input name="email" type="email" defaultValue={E?.email ?? ''} /></label>
              <label className="f">Зачленет<input name="joined" type="date" defaultValue={E?.joined ?? ''} /></label>
              <label className="f">Исчленет<input name="left" type="date" defaultValue={E?.left ?? ''} /></label>
              <label className="f">Орган<input name="organ" list="npoOrg" defaultValue={E?.organ ?? 'Член'} /></label>
              <label className="f">Функција<input name="role" list="npoRole" defaultValue={E?.role ?? 'член'} /></label>
            </div>
            <datalist id="npoOrg">{NPO_ORGANS.map((o) => <option key={o} value={o} />)}</datalist>
            <datalist id="npoRole">{NPO_ROLES.map((o) => <option key={o} value={o} />)}</datalist>
            <label className="f" style={{ display: 'block', marginTop: 6 }}>Забелешка (одлука / записник за избор, мандат…)<input name="note" defaultValue={E?.note ?? ''} style={{ width: '100%' }} /></label>
            <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn pri">Зачувај</button><Link className="btn" href="/clenovi">Откажи</Link></div>
          </BankForm>
        </div>
      )}

      {write && (
        <details className="card" open={!M.length}>
          <summary>⬆ Увоз од Excel</summary>
          <p className="mini">Колони: Име и презиме · ЕМБГ · Адреса · Телефон · Е-пошта · Зачленет · Исчленет · Орган · Функција · Забелешка (може и на албански). Ист член (ЕМБГ, или име + орган) се ажурира, новите се додаваат. Едно лице во два органи = два реда.</p>
          <BankForm action={importMembersAction}>
            <div className="row" style={{ gap: 8, alignItems: 'end' }}>
              <input type="file" name="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" required />
              <button className="btn pri">Увези</button>
              <XlsxButton name="registar-clenovi-obrazec" label="⬇ Образец" sheets={[{ name: 'Членови', rows: [HEAD] }]} className="btn sm" />
            </div>
          </BankForm>
        </details>
      )}

      <div id="clenReg">
        <h2 style={{ margin: '10px 0 2px' }}>Регистар на членови и на членовите на органите</h2>
        <p style={{ margin: '0 0 6px' }}>{firm.name}, {[firm.address, firm.city].filter(Boolean).join(', ')} · ЕДБ {firm.edb ?? ''} · состојба на {dmy(td)}{last ? ` · последно ажурирање ${dmy(last)}` : ''}</p>
        <table className="dense">
          <thead><tr><th>Р.бр.</th><th>Име и презиме</th><th>ЕМБГ</th><th>Адреса</th><th>Контакт</th><th>Зачленет</th><th>Исчленет</th><th>Орган</th><th>Функција</th><th>Забелешка</th>{write && <th className="noprint" />}</tr></thead>
          <tbody>
            {rows.map((m, i) => (
              <tr key={m.id} style={memberActive(m, td) ? undefined : { opacity: 0.55 }}>
                <td>{i + 1}</td><td>{m.name}</td><td>{m.embg ?? ''}</td><td>{m.address ?? ''}</td><td className="mini">{[m.phone, m.email].filter(Boolean).join(' · ')}</td>
                <td>{m.joined ? dmy(m.joined) : ''}</td><td>{m.left ? dmy(m.left) : ''}</td><td>{m.organ ?? ''}</td><td>{m.role ?? ''}</td><td className="mini">{m.note ?? ''}</td>
                {write && <td className="noprint" style={{ whiteSpace: 'nowrap' }}><Link className="btn sm" href={`/clenovi?id=${m.id}`}>✎</Link> <RowAction label="🗑" title="Избриши" confirm={`Да се избрише ${m.name} од регистарот? (за член што заминал внесете „Исчленет“)`} action={deleteMemberAction.bind(null, m.id)} /></td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={11} className="muted">Нема внесени членови – додајте ги или увезете ги од Excel.</td></tr>}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12mm' }}>
          <div style={{ textAlign: 'center', minWidth: '65mm' }}>Претседател / одговорно лице<div>{((firm.settings ?? {}) as { signer?: string }).signer ?? ''}</div><div style={{ height: '12mm' }} /><div style={{ borderTop: '1px solid #000' }}>потпис и печат</div></div>
        </div>
      </div>
      <p className="note">Закон за здруженија и фондации: здружението води регистар на членовите и на членовите на органите и го ажурира најмалку на секои 2 години. Рокот е и во 📅 Календар на рокови.</p>
    </>
  );
}
