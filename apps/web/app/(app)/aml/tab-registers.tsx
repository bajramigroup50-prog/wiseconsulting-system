/**
 * 📚 Регистри — the evidence the office must be able to show the supervisor (УФР, чл. 151): reports to УФР, clients and
 * risk, alerts and internal reports with decisions, trainings / confidentiality statements / internal controls. Each
 * register has its own PDF / Excel (`ScreenExport` on the card) and a print view.
 */
import { inArray } from 'drizzle-orm';
import { AML_KIND_LBL, AML_LV, AML_RULE_LBL, amlCanPurge, amlIsUfrKind, amlKindOf, amlRetainUntil, amlRetentionBase, type AmlCdd, type AmlLevel, type AmlRule } from '@wise/core/office';
import { firms } from '@wise/db';
import { dmy } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { ScreenExport } from '@/components/screen-export';
import type { AmlOffice } from '@/lib/aml';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { amlPurge } from './ufr-actions';
import type { AmlFirm, AmlRec, AmlRep } from './report-form';

const Card = ({ id, t, children, landscape }: { id: string; t: string; children: React.ReactNode; landscape?: boolean }) => (
  <div className="card tw" id={id}>
    <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>{t}</h2><div className="row noprint"><ScreenExport title={t} selector={`#${id}`} landscape={landscape} className="btn sm" /></div></div>
    {children}
  </div>
);

export async function TabRegisters({ records, reports, office: O, today, admin }: { clients: AmlFirm[]; records: AmlRec[]; reports: AmlRep[]; office: AmlOffice; today: string; admin: boolean }) {
  const ids = records.map((r) => r.firmId);
  const names = new Map((ids.length ? await db().select({ id: firms.id, name: firms.name, edb: firms.edb, active: firms.active }).from(firms).where(inArray(firms.id, ids)) : []).map((f) => [f.id, f]));
  const ufr = reports.filter((r) => amlIsUfrKind(amlKindOf(r.data))).reverse();
  const dec = reports.filter((r) => !amlIsUfrKind(amlKindOf(r.data))).reverse();
  const recs = [...records].sort((a, b) => (names.get(a.firmId)?.name ?? '').localeCompare(names.get(b.firmId)?.name ?? '', 'mk'));
  return (
    <>
      <p className="mini">Сите регистри се чуваат најмалку 10 години (чл. 62): досието на клиентот од крајот на деловниот однос, извештаите од доставувањето, документацијата од внатрешната контрола од контролата. Бришење пред истекот на рокот не е можно.</p>
      <Card id="regUfr" t="Регистар на извештаи до УФР" landscape>
        {ufr.length ? <table className="dense">
          <thead><tr><th>Р.бр.</th><th>Вид</th><th>Клиент</th><th>Обврска од</th><th>Рок</th><th>Доставено</th><th>Бр. / потврда УФР</th><th>Начин</th><th>Доставил</th><th>Се чува до</th></tr></thead>
          <tbody>{ufr.map((r, i) => {
            const d = r.data as { from?: string; due?: string; submitted?: string; ufrNo?: string; channel?: string; subBy?: string; late?: boolean };
            return <tr key={r.id}><td>{i + 1}</td><td className="mini">{AML_KIND_LBL[amlKindOf(r.data)]}</td><td>{r.firmName}</td><td>{dmy(d.from)}</td><td>{dmy(d.due)}</td>
              <td>{d.submitted ? `${dmy(d.submitted)}${d.late ? ' (по рокот)' : ''}` : 'НЕ Е ДОСТАВЕНО'}</td><td>{d.ufrNo ?? ''}</td><td>{d.channel ?? ''}</td><td>{d.subBy ?? ''}</td><td>{dmy(amlRetainUntil(d.submitted))}</td></tr>;
          })}</tbody>
        </table> : <div className="empty">Нема извештаи.</div>}
      </Card>

      <Card id="regCl" t="Регистар на клиенти и проценка на ризик" landscape>
        <table className="dense">
          <thead><tr><th>Клиент</th><th>ЕДБ</th><th>Ризик</th><th>Поени</th><th>Анализа завршена</th><th>Однос од</th><th>Однос до</th><th>PEP</th><th>Засилена / одобрение</th><th>ЦРСМ</th><th>Санкции</th><th>Последен преглед</th><th>Следен</th><th>Се чува до</th><th className="noprint"></th></tr></thead>
          <tbody>{recs.map((r) => {
            const A = r.data as AmlCdd, f = names.get(r.firmId), lv = r.level as AmlLevel;
            return <tr key={r.firmId}><td>{f?.name ?? '—'}{f && !f.active ? ' (архивирана)' : ''}</td><td>{f?.edb ?? ''}</td><td>{AML_LV[lv]?.[0] ?? r.level}</td><td>{r.score}</td><td>{dmy(A.cddDone)}</td><td>{dmy(A.relStart)}</td><td>{dmy(A.relEnd)}</td>
              <td>{A.pep || A.bo?.some((b) => b.pep) ? 'да' : 'не'}</td><td>{lv === 'high' || lv === 'midhi' ? (A.mgrOk ? `одобрено ${dmy(A.mgrOk)}` : 'БЕЗ ОДОБРЕНИЕ') : '—'}</td>
              <td>{A.crsm?.date ? `${dmy(A.crsm.date)} ${A.crsm.result === 'match' ? '✓' : A.crsm.result === 'mismatch' ? 'несогласување' : A.crsm.result === 'none' ? 'не е запишан' : ''}` : '—'}</td>
              <td>{A.sanc?.date ? `${dmy(A.sanc.date)} ${A.sanc.result === 'none' ? '✓' : A.sanc.result === 'hit' ? 'СОВПАЃАЊЕ' : A.sanc.result === 'possible' ? 'за проверка' : ''}` : '—'}</td>
              <td>{dmy(r.lastReview)}</td><td>{dmy(r.nextReview)}</td><td>{A.relEnd ? dmy(amlRetainUntil(A.relEnd)) : 'трае односот'}</td>
              <td className="noprint">{admin && amlCanPurge(A.relEnd, today) && <RowAction action={amlPurge.bind(null, r.firmId, 'client')} label="Избриши (истечен рок)" confirm="Рокот од 10 години истекол. Да се избрише досието?" className="btn sm" />}</td></tr>;
          })}</tbody>
        </table>
      </Card>

      <Card id="regDec" t="Регистар на сигнали, внатрешни пријави и одлуки" landscape>
        {dec.length ? <table className="dense">
          <thead><tr><th>Датум</th><th>Вид</th><th>Клиент</th><th>Опис</th><th className="n">Износ</th><th>Статус</th><th>Одлука и образложение</th><th>Се чува до</th><th className="noprint"></th></tr></thead>
          <tbody>{dec.map((r) => {
            const d = r.data as { rule?: AmlRule; amount?: number; decision?: { at: string; byName: string; result: string; reason: string } };
            const base = amlRetentionBase(r.data);
            return <tr key={r.id}><td>{dmy(r.createdAt)}</td><td className="mini">{amlKindOf(r.data) === 'alert' ? (d.rule ? AML_RULE_LBL[d.rule] : 'сигнал') : 'внатрешна пријава'}</td><td>{r.firmName}</td><td className="mini">{r.text}</td>
              <td className="n">{d.amount ? fmt(Number(d.amount)) : ''}</td><td>{r.status}</td>
              <td className="mini">{d.decision ? `${d.decision.result === 'none' ? 'без сомневање' : 'извештај до УФР'}: ${d.decision.reason} (${dmy(d.decision.at)}, ${d.decision.byName})` : '—'}</td>
              <td>{base ? dmy(amlRetainUntil(base)) : '—'}</td>
              <td className="noprint">{admin && amlCanPurge(base, today) && <RowAction action={amlPurge.bind(null, r.id, 'report')} label="Избриши" confirm="Рокот од 10 години истекол. Да се избрише?" className="btn sm" />}</td></tr>;
          })}</tbody>
        </table> : <div className="empty">Нема записи.</div>}
      </Card>

      <Card id="regTr" t="Евиденција на обуки, изјави за доверливост и внатрешни контроли">
        <h3 style={{ fontSize: 14, margin: '4px 0' }}>Обуки (чл. 12, најмалку 2 годишно)</h3>
        <table className="dense"><thead><tr><th>Датум</th><th>Тема</th><th>Учесници</th></tr></thead>
          <tbody>{[...(O.tr ?? [])].sort((a, b) => b.date.localeCompare(a.date)).map((t, i) => <tr key={i}><td>{dmy(t.date)}</td><td>{t.topic}</td><td>{t.who ?? ''}</td></tr>)}</tbody></table>
        <h3 style={{ fontSize: 14, margin: '8px 0 4px' }}>Изјави за доверливост (чл. 72 ст.3)</h3>
        <table className="dense"><thead><tr><th>Вработен</th><th>Датум</th></tr></thead>
          <tbody>{(O.conf ?? []).map((c, i) => <tr key={i}><td>{c.name}</td><td>{dmy(c.date)}</td></tr>)}</tbody></table>
        <h3 style={{ fontSize: 14, margin: '8px 0 4px' }}>Внатрешни контроли (чл. 69)</h3>
        <table className="dense"><thead><tr><th>Датум</th><th>За година</th><th>Наоди</th><th>Мерки</th><th>Извршил</th><th>Се чува до</th></tr></thead>
          <tbody>{[...(O.ctlLog ?? [])].reverse().map((c, i) => <tr key={i}><td>{dmy(c.date)}</td><td>{c.period ?? ''}</td><td className="mini">{c.findings}</td><td className="mini">{c.measures}</td><td>{c.by}</td><td>{dmy(amlRetainUntil(c.date))}</td></tr>)}</tbody></table>
      </Card>
    </>
  );
}
