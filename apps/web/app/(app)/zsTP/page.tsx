/**
 * Legacy `VIEWS.zsTP` 10499 (+ ACT `tpSave`/`tpPdf`) — Годишна сметка – ТП / самостојна дејност: Образец „Б“ + ДЛД-ДБ.
 * FIX(P8 #13): legacy `onchange` only mutated memory (lost on reload); inputs are saved by a guarded, audited action.
 * Gap: the simple-bookkeeping books КП/КТ/КО/КПС (`tpBookHTML`) are not ported yet.
 */
import Link from 'next/link';
import { phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { ActionForm } from '@/components/yearend/action-form';
import { TpTables } from '@/components/yearend/entity-tables';
import { NotClosedNote, ZsHead } from '@/components/yearend/ph-bar';
import { saveDld } from '../zsProc/actions';

export default async function ZsTpPage() {
  const c = await yePage('zsTP', 'zsTP');
  if (!c) return <NoFirm t="Годишна сметка – ТП / самостојна дејност" />;
  const { L, firm, year } = c;
  return (
    <>
      <ZsHead id="zsTP" t={`Годишна сметка – ${L.ent === 'sd' ? 'самостојна дејност' : 'трговец поединец'}`} year={year} ent={L.ent} done={phaseDone(L)}>
        <Link className="btn pri" href="/pecati/tp" target="_blank">🖨 Б + ДЛД-ДБ (печати / PDF)</Link>
      </ZsHead>
      <NotClosedNote closed={L.Y.closed} year={year} />
      <ActionForm action={saveDld} submit="Зачувај" className="">
        <TpTables T={L.Y.tp!} firm={firm} year={year} />
      </ActionForm>
      <p className="note">Данок на личен доход од самостојна дејност: 10% од разликата меѓу приходите и расходите зголемена за непризнаените расходи. Данокот од ДЛД-ДБ се книжи при затворањето на годината (8100 / 2330). ТП не може да премине на данок на вкупен приход.</p>
    </>
  );
}
