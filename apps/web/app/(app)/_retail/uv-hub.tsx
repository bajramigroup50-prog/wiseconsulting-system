/**
 * Увоз од Excel / XML – материјално / малопродажба — legacy `UVH` + `uvHub` 17199–17222 and `ACT.uvGo`: what can be
 * imported and where it lands. `imp` and the stock-list kinds open the generic import with the chosen location;
 * the others open the screen that reads them.
 */
import Link from 'next/link';
import { booksPage } from '@/lib/books';
import { locationOptions } from '@/lib/sales';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

type How = 'imp' | 'go';
const UVH: Record<'mat' | 'malo', { t: string; it: [string, How, string, string, string, string?][] }> = {
  mat: { t: 'Увоз од Excel / XML – материјално', it: [
    ['items', 'imp', 'Артикли и услуги (шифрарник)', 'Шифра, назив, баркод, мерка, цена, ДДВ. Постоечките се ажурираат.', '→ Шифрарник'],
    ['vlez', 'go', 'Влезна фактура со ставки – домашна или увозна', 'Внесете ја во Влез (со калкулација, царина и трошоци); ставките се читаат и од скен / PDF / UBL XML.', '→ Влез · налог 2 · лагер · картица на производ · ДДВ книга влезни', '/vlez?nov'],
    ['purchases', 'imp', 'Влезни фактури (износи по стапки)', 'Секоја фактура се книжи во налог „Влезни фактури“, добавувачите се додаваат.', '→ Налог 2 · ДДВ книга влезни · картица добавувач'],
    ['invoices', 'imp', 'Излезни фактури (ставки)', 'Фактури со ставки, купувачи, рок.', '→ Налог 1 · ДДВ книга излезни · картица купувач'],
    ['in', 'imp', 'Приемница / почетна залиха во магацин (количина + набавна цена)', 'Excel од стариот програм или од попис.', '→ Лагер листа · материјална картица · ЕТ на големо'],
    ['pop', 'imp', 'Попис во магацин (пописани количини)', 'Кусок / вишок се пресметува автоматски.', '→ Лагер листа (кусок / вишок)'],
    ['journal', 'imp', 'Налог за книжење (ставки)', 'Конто, должи, побарува, комитент.', '→ Налози · бруто биланс'],
    ['efaktura', 'go', 'Е-Фактура (XML од е-фактура системот)', 'Влезни и излезни е-фактури.', '→ Влез / Излез', '/efaktura'],
  ] },
  malo: { t: 'Увоз од Excel / XML – малопродажба', it: [
    ['items', 'imp', 'Артикли (шифрарник) со малопродажни цени', 'Шифра, назив, баркод, МПЦ, ДДВ.', '→ Шифрарник'],
    ['in', 'imp', 'Приемница / почетна залиха во продавница (количина + набавна цена + МПЦ)', 'Секоја приемница е ПЛТ.', '→ Лагер листа · картица на производ · МЕТГ кол. 5 и 6'],
    ['pop', 'imp', 'Попис во продавница', 'Кусок / вишок по продажни цени.', '→ Лагер листа · МЕТГ (кусок / вишок)'],
    ['nivel', 'imp', 'Нови малопродажни цени → нивелација (Шифра · Нова цена)', 'Количината е залихата на денот.', '→ Нивелација · МЕТГ кол. 6 · налог Залихи'],
    ['fiskPer', 'go', 'Дневен промет – фискални извештаи (скен, PDF или рачно)', 'Периодичен или дневни Z извештаи.', '→ Налог Дневен промет · КДФИ-01 · МЕТГ кол. 7 · ДДВ-04 · POS 1200001', '/fiskPer'],
    ['vlez', 'go', 'Влезна фактура со ставки – домашна или увозна', 'Се внесува во избраната продавница.', '→ Влез · лагер · МЕТГ кол. 5 и 6 · налог', '/vlez?nov'],
    ['masovnoM', 'go', 'Масовно внесување влезни фактури (скен / PDF)', 'Повеќе фактури одеднаш.', '→ Влезни калкулации · МЕТГ · налог', '/masovnoM'],
    ['purchases', 'imp', 'Влезни фактури (износи по стапки)', 'Само финансиски, без количини.', '→ Налог 2 · ДДВ книга влезни'],
  ] },
};

export async function UvHub({ k, sp }: { k: 'mat' | 'malo'; sp: { wh?: string } }) {
  const view = k === 'malo' ? 'uvozMalo' : 'uvozMat';
  const H = UVH[k];
  const { firm } = await booksPage(view);
  if (!firm) return <NoFirm t={H.t} />;
  const locs = [{ id: 'main', name: 'Главен магацин', kind: 'warehouse' }, ...(await locationOptions(firm.id))];
  const own = locs.filter((l) => (k === 'malo' ? l.kind === 'store' : l.kind !== 'store'));
  const W = locs.some((l) => l.id === sp.wh) ? sp.wh! : own[0]?.id ?? 'main';
  return (
    <>
      <Hd t={H.t} sub="избери што се увезува – програмата ги поврзува книжењата и книгите" />
      <form className="card"><div className="row" style={{ alignItems: 'end' }}>
        <label className="f" style={{ maxWidth: 340 }}>{k === 'malo' ? 'Продавница' : 'Магацин / објект'}<select name="wh" defaultValue={W}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}{l.kind === 'store' ? ' · продавница' : ''}</option>)}</select></label>
        <button className="btn">Избери</button>
      </div>
        {k === 'malo' && !locs.some((l) => l.kind === 'store') && <p className="note" style={{ color: 'var(--bad)' }}>Немате регистрирано продавница – додадете ја во Шифрарник → Продавници (за МЕТГ).</p>}
      </form>
      <div className="tw"><table>
        <thead><tr><th>Што се увезува</th><th>Каде влегува</th><th /></tr></thead>
        <tbody>{H.it.map(([t, how, n, d, lk, href]) => (
          <tr key={t + n}><td><b>{n}</b><br /><small className="mut">{d}</small></td><td><small>{lk}</small></td>
            <td><Link className="btn sm pri" href={how === 'imp' ? `/uvoz?t=${t}&wh=${W}&back=${view}` : href!}>Отвори</Link></td></tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
