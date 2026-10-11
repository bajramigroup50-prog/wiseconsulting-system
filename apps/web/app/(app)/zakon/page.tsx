/**
 * „⚖ Законска усогласеност“ — every legal obligation of the current firm with ✓ / ⚠ / ✗ and a link to fix it
 * (docs/legal/COMPLIANCE.md), the register of processing activities (ЗЗЛП чл. 34), data-subject requests with the
 * reply that respects the retention periods, and the retention table the program enforces.
 */
import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { CMP_MARK, complianceRows, complianceScore, DSR_TYPES, RETENTION, type CmpStatus, type ProcessingActivity } from '@wise/core/compliance';
import { complianceFacts, gdprRecords } from '@wise/db';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { DownloadCsv } from '@/components/download-csv';
import { Hd, dmy } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { closeDsr, saveActivity, saveDsr, seedRopa } from './actions';

const CLS: Record<CmpStatus, string> = { ok: 'good', warn: 'warn', bad: 'bad', na: '', todo: 'info' };

export default async function ZakonPage() {
  const { firm } = await officePage('zakon', { perm: 'office' });
  if (!firm) return <NoFirm t="⚖ Законска усогласеност" />;
  const td = today();
  const year = await currentYear();
  const [F, G] = await Promise.all([
    complianceFacts(db(), firm.id, year, td),
    db().select().from(gdprRecords).where(and(eq(gdprRecords.firmId, firm.id))).orderBy(desc(gdprRecords.date)),
  ]);
  if (!F) return <NoFirm t="⚖ Законска усогласеност" />;
  const R = complianceRows(F);
  const S = complianceScore(R);
  const acts = G.filter((g) => g.kind === 'activity');
  const reqs = G.filter((g) => g.kind === 'request');
  const areas = [...new Set(R.map((r) => r.area))];
  const csv: (string | number | null)[][] = [['Област', 'Обврска', 'Состојба', 'Опис', 'Закон / член'], ...R.map((r) => [r.area, r.title, CMP_MARK[r.s], r.txt, r.law])];
  return (
    <>
      <Hd t="⚖ Законска усогласеност" sub={`${firm.name} · ${year}`}>
        <DownloadCsv name={`Uskladenost_${firm.name}_${year}.csv`} rows={csv} label="⬇ Excel (CSV)" />
        <Link className="btn" href="/kontroli">📑 Контроли и решенија</Link>
        <Link className="btn" href="/insp">🕵 Подготвеност за инспекција</Link>
      </Hd>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '0 0 10px', alignItems: 'stretch' }}>
        {([['Усогласеност', `${S.pct}%`, ''], ['✓ Во ред', S.ok, 'good'], ['⚠ За проверка', S.warn, 'warn'], ['✗ Неусогласено', S.bad, 'bad'], ['? За потврда', S.todo, 'info']] as const).map(([l, v, c]) => (
          <div key={l} className={`card ${c}`} style={{ flex: 1, minWidth: 130, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div></div>
        ))}
      </div>
      <div className="callout">Проверките се пресметуваат од книгите на фирмата за {year}. Програмата <b>блокира</b>: книжење во заклучен период и во затворен ДДВ период, издавање / е-пошта на фактура без задолжителните елементи, бришење на издадена фактура (станува сторно со зачуван број), измена или бришење на дневникот на активности. Останатото е предупредување со врска до екранот за поправка.</div>
      <div className="card tw" id="cmpTable">
        <table className="dense">
          <thead><tr><th style={{ width: 28 }} /><th>Обврска</th><th>Состојба</th><th>Закон / член</th><th /></tr></thead>
          <tbody>{areas.flatMap((a) => [
            <tr key={`h-${a}`}><td colSpan={5} style={{ background: 'var(--bg2, #f3f4f6)', fontWeight: 700 }}>{a}</td></tr>,
            ...R.filter((r) => r.area === a).map((r) => (
              <tr key={r.id}>
                <td><span className={`pill ${CLS[r.s]}`}>{CMP_MARK[r.s]}</span></td>
                <td><b>{r.title}</b></td>
                <td>{r.txt}</td>
                <td className="mini">{r.law}</td>
                <td>{r.go && r.s !== 'ok' && r.s !== 'na' && <Link className="btn sm" href={`/${r.go}`}>Поправи →</Link>}</td>
              </tr>
            )),
          ])}</tbody>
        </table>
      </div>

      <div className="card" id="ropa">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>📒 Евиденција на активностите за обработка на лични податоци (ЗЗЛП чл. 34)</h2>
        <p className="mini" style={{ margin: '0 0 6px' }}>Клиентот е контролор, канцеларијата обработувач (договор по чл. 32 – <Link href="/zzlp">🔐 ЗЗЛП</Link>). Евиденцијата се чува и се дава на увид на Агенцијата на барање.</p>
        {acts.length ? <div className="tw"><table className="dense">
          <thead><tr><th>Активност</th><th>Цел</th><th>Правен основ</th><th>Субјекти / податоци</th><th>Примачи</th><th>Рок на чување</th></tr></thead>
          <tbody>{acts.map((g) => { const a = g.data as Partial<ProcessingActivity>; const r = a.retention ? RETENTION[a.retention] : null; return (
            <tr key={g.id}><td><b>{g.subject}</b>{a.special ? <div className="pill warn">посебна категорија</div> : null}</td><td>{a.purpose}</td><td className="mini">{a.basis}</td><td className="mini">{a.subjects}: {a.data}</td><td className="mini">{a.recipients}</td><td className="mini">{r ? (r.years == null ? 'трајно' : `${r.years} год.`) : ''}</td></tr>
          ); })}</tbody>
        </table></div> : <div className="callout warn">Нема евидентирани активности.</div>}
        <div className="row" style={{ gap: 6, marginTop: 6 }}><RowAction action={seedRopa} label="+ Додај ги стандардните активности (плата, боледување, персонал, комитенти, АМЛ, портал)" className="btn sm pri" showOk /></div>
      </div>
      <ActionForm action={saveActivity}>
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>+ Друга активност за обработка</h2>
        <div className="form">
          <label className="f">Назив<input name="name" required /></label>
          <label className="f wide">Цел<input name="purpose" /></label>
          <label className="f wide">Правен основ (ЗЗЛП чл. 10)<input name="basis" placeholder="пр. законска обврска – Закон за …" /></label>
          <label className="f">Категории субјекти<input name="subjects" /></label>
          <label className="f wide">Категории податоци<input name="data" /></label>
          <label className="f">Примачи<input name="recipients" /></label>
          <label className="f">Рок на чување<select name="retention" defaultValue="books">{Object.values(RETENTION).map((r) => <option key={r.kind} value={r.kind}>{r.label} – {r.years == null ? 'трајно' : `${r.years} год.`}</option>)}</select></label>
          <label className="f wide">Мерки за безбедност<input name="security" /></label>
          <label className="chk"><input type="checkbox" name="special" /> посебна категорија (здравје, …)</label>
        </div>
        <button className="btn sm" style={{ marginTop: 6 }}>Зачувај</button>
      </ActionForm>

      <div className="card" id="dsr">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>🙋 Барања од субјекти (пристап, исправка, бришење …) – одговор во рок од еден месец (ЗЗЛП чл. 16)</h2>
        {reqs.length ? <div className="tw"><table className="dense">
          <thead><tr><th>Примено</th><th>Барање</th><th>Рок</th><th>Предлог-одговор (со законските рокови на чување)</th><th>Статус</th><th /></tr></thead>
          <tbody>{reqs.map((g) => { const d = g.data as { reply?: string }; const late = g.status === 'open' && g.due && g.due < td; return (
            <tr key={g.id}><td>{dmy(g.date)}</td><td>{g.subject}</td><td style={late ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{dmy(g.due)}</td><td className="mini">{d.reply ?? ''}</td>
              <td><span className={`pill ${g.status === 'open' ? 'warn' : 'good'}`}>{g.status === 'open' ? 'отворено' : 'одговорено'}</span></td>
              <td>{g.status === 'open' && <RowAction action={closeDsr.bind(null, g.id)} label="✓ Одговорено" />}</td></tr>
          ); })}</tbody>
        </table></div> : <div className="empty">Нема барања.</div>}
      </div>
      <ActionForm action={saveDsr}>
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>+ Ново барање од субјект</h2>
        <div className="form">
          <label className="f">Вид<select name="type">{Object.entries(DSR_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="f">Лице<input name="person" required placeholder="име и презиме" /></label>
          <label className="f">Примено на<input name="received" type="date" defaultValue={td} /></label>
          <label className="f wide">Белешка<input name="note" /></label>
        </div>
        <p className="mini" style={{ margin: '6px 0 2px' }}>Кои податоци за лицето постојат (и датум на последниот документ) – за бришење програмата ги задржува оние што законот бара да се чуваат:</p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          {(['payroll', 'personnel', 'invoice', 'contract', 'aml'] as const).map((k) => (
            <label key={k} className="chk" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" name={`cat_${k}`} /> {RETENTION[k].label} <input name={`last_${k}`} type="date" style={{ width: 140 }} /></label>
          ))}
        </div>
        <button className="btn sm pri" style={{ marginTop: 6 }}>Евидентирај и предложи одговор</button>
      </ActionForm>

      <div className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>🗄 Рокови на чување што програмата ги почитува</h2>
        <table className="dense"><thead><tr><th>Документи</th><th>Рок</th><th>Извор</th></tr></thead>
          <tbody>{Object.values(RETENTION).map((r) => <tr key={r.kind}><td>{r.label}</td><td>{r.years == null ? 'трајно' : `${r.years} години по крајот на годината`}{r.confirm ? <span className="pill info" title="Читање на програмата – за потврда од канцеларијата"> за потврда</span> : null}</td><td className="mini">{r.law}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
