/**
 * Упросечување — legacy `VIEWS.uprosek` 5113, ACT `runUprosek` 7365 → `reaverage()` 5101: re-run the weighted
 * average by date per item and location and re-post the affected stock journals. Moves in a locked period are left
 * unchanged.
 */
import { stockPage } from '@/lib/stock';
import { canDo } from '@/lib/books';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { reaverageAction } from '../_stock/actions';

export default async function UprosekPage() {
  const { u, firm, L } = await stockPage('uprosek');
  if (!firm || !L) return <NoFirm t="Упросечување" />;
  const moves = L.ctx.moves.filter((m) => !m.pend);
  return (
    <>
      <Hd t="Упросечување" sub="пресметка на просечна набавна цена" />
      <div className="card">
        <p>Повторно ги пресметува излезите по пондерирана просечна цена по датум, за секој артикл и објект (на пр. по внесена влезна фактура со постар датум), ги поправа преносите и производството и ги прекнижува налозите за залиха.</p>
        <p className="note">Движења на залиха: {moves.length}. {L.firm.lockDate ? `Движењата до заклучениот датум ${L.firm.lockDate.split('-').reverse().join('.')} не се менуваат.` : ''}</p>
        {canDo(u, 'runUprosek', firm.id) && <RowAction action={reaverageAction} label="Пресметај просечни цени" className="btn pri" confirm="Да се пресметаат повторно просечните цени и да се прекнижат налозите за залиха?" />}
      </div>
    </>
  );
}
