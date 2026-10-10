/** Legacy `zsView('zs_pr')` 7695 (+ `prTpl` / `prImport` / `zprSave` / `prReset` 7702–7730) — Правила за завршна пресметка. */
import { canDo } from '@/lib/books';
import { phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { ZsHead } from '@/components/yearend/ph-bar';
import { RulesEditor } from './rules-editor';

export default async function ZsPrPage() {
  const c = await yePage('zs_pr');
  if (!c) return <NoFirm t="Правила за завршна пресметка" />;
  const { L, u, firm, year } = c;
  return (
    <>
      <ZsHead id="zs_pr" t="Правила за завршна пресметка" year={year} ent={L.ent} done={phaseDone(L)} />
      <div className="callout">Секоја АОП позиција се пресметува од салдата на контата што почнуваат со наведените префикси (на пр. <b>74</b> = сите конта 74xx), или со формула од други АОП (на пр. <b>201-204+212-213</b>). Знак <b>−</b> значи побарувачко салдо (приходи, капитал, обврски). Посебни формули: <b>TAX</b> = данок од затворањето, <b>+PROFIT</b> = додади го резултатот ако годината не е затворена. Овде можете да ги внесете точните АОП од образецот на ЦРРСМ или да ги увезете од Excel (на пр. од Зонел).</div>
      <RulesEditor rules={L.rules.map((x) => ({ ...x }))} canSave={canDo(u, 'settings', firm.id)} />
    </>
  );
}
