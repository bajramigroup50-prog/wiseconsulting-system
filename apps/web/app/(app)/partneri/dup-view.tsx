/**
 * Комитенти › „Дупликати“: groups of likely duplicate partners (same ЕДБ / ЕМБС or a name very similar to the group's
 * main partner — the match helper `@wise/core/partners/match`) with the suggested main partner; per member a „спои“
 * tick (only the ticked ones are merged), „⇢ Спои во избраниот“ per group and „Спои ги сите сигурни“ (with the list of
 * groups in the confirm). Everyone who sees the partners sees the list; merging needs `settings` or `fix`.
 */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { partnerDupGroups, partners } from '@wise/db';
import { DUP_SCORE } from '@wise/core/partners/match';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { ActionForm } from '@/components/action-form';
import { RowAction } from '@/components/row-action';
import { mergePartnersAction, mergeSurePartnersAction, notDupAction } from './actions';
import { ManualMerge } from './manual-merge';

export async function PartnerDupView({ firmId, canMerge, note }: { firmId: string; canMerge: boolean; note?: React.ReactNode }) {
  const [V, PL] = await Promise.all([
    partnerDupGroups(db(), firmId),
    canMerge ? db().select({ id: partners.id, code: partners.code, name: partners.name, edb: partners.edb, city: partners.city }).from(partners).where(eq(partners.firmId, firmId)).orderBy(asc(partners.name)) : Promise.resolve([]),
  ]);
  const S = V.groups.filter((g) => g.sure);
  const label = (r: { code: string | null; name: string }) => `${r.code ?? ''} ${r.name}`.trim();
  const sureList = S.map((g) => { const m = g.rows.find((r) => r.id === g.main)!; return `• ${label(m)} ← ${g.rows.filter((r) => r.id !== g.main).map(label).join('; ')}`; });
  const ask = `Да се спојат ${S.length} сигурни групи (ист ЕДБ / ЕМБС или речиси исто име) во главниот комитент (прв во редот):\n\n${sureList.slice(0, 40).join('\n')}${sureList.length > 40 ? `\n… и уште ${sureList.length - 40}` : ''}`;
  const sureAction = mergeSurePartnersAction.bind(null, S.map((g) => ({ main: g.main, ids: g.members.map((m) => m.id) })));
  return (
    <>
      <Hd t="Комитенти – дупликати" sub={`${V.groups.length} групи`}><Link className="btn" href="/partneri">← Комитенти</Link></Hd>
      <div className="callout">Комитенти со ист ЕДБ / ЕМБС или многу слично име (кратенки, латиница/кирилица, правна форма) со главниот комитент на групата; комитенти со различен ЕДБ / ЕМБС никогаш не се во иста група. Се спојуваат само штиклираните „спои“. При спојување фактурите, налозите (и почетната состојба), изводите, касата, налозите за плаќање, опомените и сите други записи се префрлаат на главниот; празните ЕДБ, ЕМБС, адреса и сметки се дополнуваат, а другите имиња остануваат за препознавање при скенирање. Салдата по конта не се менуваат; во заклучен период спојувањето се одбива.</div>
      {note}
      {canMerge && <ManualMerge partners={PL} action={mergePartnersAction} />}
      {canMerge && S.length > 0 && <div className="row" style={{ margin: '0 0 10px' }}><RowAction className="btn sm" action={sureAction} label={`⇢ Спои ги сите сигурни (${S.length})`} confirm={ask} showOk /></div>}
      {!canMerge && V.groups.length > 0 && <p className="note">Спојувањето бара право „поставки“ или „корекција“.</p>}
      {V.groups.length ? V.groups.map((g) => (
        <ActionForm key={g.main} action={mergePartnersAction} className="card" reset={false}>
          <input type="hidden" name="group" value={g.rows.map((r) => r.id).join(',')} />
          <div className="tw"><table className="dense">
            <thead><tr><th style={{ width: 60 }}>Главен</th><th style={{ width: 50 }}>Спои</th><th>Шифра</th><th>Назив</th><th>ЕДБ</th><th>ЕМБС</th><th>Град</th><th className="n">Движења</th><th className="n">Сличност</th></tr></thead>
            <tbody>{g.rows.map((r) => {
              const isMain = r.id === g.main;
              const ok = isMain || r.sameId || r.score >= DUP_SCORE;
              return <tr key={r.id}>
                <td><input type="radio" name="main" value={r.id} defaultChecked={isMain} disabled={!canMerge} /></td>
                <td><label className="row" style={{ gap: 4, alignItems: 'center' }}><input type="checkbox" name="ids" value={r.id} defaultChecked={ok} disabled={!canMerge} /><span className="muted">спои</span></label></td>
                <td>{r.code}</td><td><Link href={`/partneri?edit=${r.id}`}><b>{r.name}</b></Link></td><td>{r.edb}</td><td>{r.embs}</td><td>{r.city}</td>
                <td className="n">{r.moves}</td>
                <td className="n">{isMain ? '—' : r.sameId ? 'ист број' : Math.round(r.score * 100) + '%'}{r.distinct && <span className="pill warn" style={{ marginLeft: 4 }} title="Различна правна форма или збор во името (на пр. ШПК ↔ ИНТЕРНАЦИОНАЛ) – можеби друга фирма">различно</span>}</td>
              </tr>;
            })}</tbody>
          </table></div>
          <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
            {g.sure ? <span className="pill good">сигурно</span> : <span className="pill warn">проверете</span>}
            {canMerge && <button className="btn sm pri">⇢ Спои ги штиклираните во избраниот</button>}
            {canMerge && <RowAction className="btn sm" label="✕ Не се исти" action={notDupAction.bind(null, g.rows.map((r) => r.id))}
              confirm="Овие комитенти се РАЗЛИЧНИ (не се спојуваат)? Повеќе нема да се предлагаат како дупликати." />}
          </div>
        </ActionForm>
      )) : <div className="card empty">Нема комитенти што личат на дупликати.</div>}
    </>
  );
}
