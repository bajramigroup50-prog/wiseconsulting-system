/**
 * Комитенти › „Дупликати“: groups of likely duplicate partners (same ЕДБ / ЕМБС or a very similar name — the match
 * helper `@wise/core/partners/match`) with the suggested main partner; „⇢ Спои во избраниот“ per group and „Спои ги
 * сите сигурни“. Everyone who sees the partners sees the list; merging needs `settings` or `fix`.
 */
import Link from 'next/link';
import { partnerDupGroups } from '@wise/db';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { ActionForm } from '@/components/action-form';
import { RowAction } from '@/components/row-action';
import { mergePartnersAction, mergeSurePartnersAction } from './actions';

export async function PartnerDupView({ firmId, canMerge }: { firmId: string; canMerge: boolean }) {
  const V = await partnerDupGroups(db(), firmId);
  const sure = V.groups.filter((g) => g.sure).length;
  return (
    <>
      <Hd t="Комитенти – дупликати" sub={`${V.groups.length} групи`}><Link className="btn" href="/partneri">← Комитенти</Link></Hd>
      <div className="callout">Комитенти со ист ЕДБ / ЕМБС или многу слично име (кратенки, латиница/кирилица, правна форма). При спојување фактурите, налозите (и почетната состојба), изводите, касата, налозите за плаќање, опомените и сите други записи се префрлаат на главниот; празните ЕДБ, ЕМБС, адреса и сметки се дополнуваат, а другите имиња остануваат за препознавање при скенирање. Салдата по конта не се менуваат; во заклучен период спојувањето се одбива.</div>
      {canMerge && sure > 0 && <div className="row" style={{ margin: '0 0 10px' }}><RowAction className="btn sm" action={mergeSurePartnersAction} label={`⇢ Спои ги сите сигурни (${sure})`} confirm={`Да се спојат ${sure} сигурни групи (ист ЕДБ / ЕМБС или над 90% слично име) во предложениот главен комитент?`} showOk /></div>}
      {!canMerge && V.groups.length > 0 && <p className="note">Спојувањето бара право „поставки“ или „корекција“.</p>}
      {V.groups.length ? V.groups.map((g) => (
        <ActionForm key={g.main} action={mergePartnersAction} className="card" reset={false}>
          <input type="hidden" name="ids" value={g.rows.map((r) => r.id).join(',')} />
          <div className="tw"><table className="dense">
            <thead><tr><th style={{ width: 70 }}>Главен</th><th>Шифра</th><th>Назив</th><th>ЕДБ</th><th>ЕМБС</th><th>Град</th><th className="n">Движења</th><th className="n">Сличност</th></tr></thead>
            <tbody>{g.rows.map((r) => <tr key={r.id}>
              <td><input type="radio" name="main" value={r.id} defaultChecked={r.id === g.main} disabled={!canMerge} /></td>
              <td>{r.code}</td><td><Link href={`/partneri?edit=${r.id}`}><b>{r.name}</b></Link></td><td>{r.edb}</td><td>{r.embs}</td><td>{r.city}</td>
              <td className="n">{r.moves}</td><td className="n">{r.id === g.main ? '—' : r.sameId ? 'ист број' : Math.round(r.score * 100) + '%'}</td>
            </tr>)}</tbody>
          </table></div>
          <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
            {g.sure ? <span className="pill good">сигурно</span> : <span className="pill warn">проверете</span>}
            {canMerge && <button className="btn sm pri">⇢ Спои во избраниот</button>}
          </div>
        </ActionForm>
      )) : <div className="card empty">Нема комитенти што личат на дупликати.</div>}
    </>
  );
}
