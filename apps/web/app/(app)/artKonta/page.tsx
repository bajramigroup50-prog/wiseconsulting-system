/**
 * Распоред на артикли по конта — legacy `VIEWS.artKonta` 8445, `ART_ROLES`, `artRole`, `akSave`, `prodRawK`.
 * Per item: trade goods (6600), raw material (3100), own production (issued from the raw-material account at the cost
 * price or % of the selling price) or a service; valid for this firm and for new documents.
 */
import { asc, eq } from 'drizzle-orm';
import { Retail } from '@wise/core';
import { items } from '@wise/db';
import { db } from '@/lib/db';
import { firmScheme } from '@/lib/sales';
import { settingsOf } from '@/lib/retail';
import { booksPage, canDo } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ActionForm } from '@/components/action-form';
import { artKontaAction } from '../_retail/actions';

type SP = { q?: string; role?: string };

export default async function ArtKontaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('artKonta');
  if (!firm) return <NoFirm t="Распоред на артикли по конта" />;
  const write = canDo(u, 'akSave', firm.id);
  const rawDef = String(settingsOf(firm).prodRawK ?? '3100');
  const stockK = firmScheme(firm, 'stock', '6600'), matK = firmScheme(firm, 'material', '3100');
  const all = await db().select().from(items).where(eq(items.firmId, firm.id)).orderBy(asc(items.name));
  const roleOf = (it: (typeof all)[number]) => Retail.artRole({ type: it.type, rawK: it.rawAccount });
  const cnt = (r: string) => all.filter((it) => roleOf(it) === r).length;
  const q = (sp.q ?? '').toLowerCase().trim();
  const L = all.filter((it) => (!sp.role || roleOf(it) === sp.role) && (!q || `${it.name} ${it.code ?? ''}`.toLowerCase().includes(q)));
  const kOf = (r: string, it: (typeof all)[number]) => r === 'goods' ? 'влез и излез: ' + stockK : r === 'material' ? 'влез: ' + matK : r === 'prod' ? 'излез: раздолжи од ' + (it.rawAccount || rawDef) : '—';
  const link = (r: string) => '/artKonta?' + new URLSearchParams(Object.entries({ q: sp.q, role: r }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <Hd t="Распоред на артикли по конта" sub={`${firm.name} · важи само за оваа фирма`} />
      <form className="row" style={{ marginBottom: 8, gap: 8 }}><input type="hidden" name="role" value={sp.role ?? ''} /><input name="q" placeholder="🔍 Назив, шифра…" defaultValue={sp.q ?? ''} style={{ width: 240 }} /><button className="btn">Барај</button></form>
      <ActionForm action={artKontaAction} className="" reset={false}>
        <div className="card">
          <p className="note" style={{ margin: '0 0 8px' }}>Означете за секој артикл каде оди. <b>Влез</b> (влезни фактури): трговија → {stockK}, суровина/материјал → {matK}. <b>Излез</b> (продажба): трговија се раздолжува од {stockK}; <b>сопствено производство</b> се раздолжува од конто <input name="rawK" defaultValue={rawDef} style={{ width: 80 }} /> со себечената цена (или % од продажната).</p>
          <div className="row" style={{ gap: '6px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
            <a className={`btn sm ${!sp.role ? 'pri' : ''}`} href={link('')}>Сите ({all.length})</a>
            {Retail.ART_ROLES.map(([k, n]) => <a key={k} className={`btn sm ${sp.role === k ? 'pri' : ''}`} href={link(k)}>{n} ({cnt(k)})</a>)}
          </div>
          {write && <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="mini">Избраните (☑) означи како:</span>
            <select name="bulk" defaultValue="" style={{ width: 'auto' }}><option value="">— без промена —</option>{Retail.ART_ROLES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
            <button className="btn pri">Зачувај промени</button>
          </div>}
        </div>
        <div className="tw"><table className="dense">
          <thead><tr><th style={{ width: 26 }} /><th>Шифра</th><th>Назив</th><th>Ед.</th><th className="n">Прод. цена</th><th>Вид</th><th>Конто</th><th className="n">Себечена цена</th><th className="n">или %</th></tr></thead>
          <tbody>{L.map((it) => {
            const r = roleOf(it);
            const cp = it.costPrice == null ? '' : String(Number(it.costPrice)), pc = it.costPct == null ? '' : String(Number(it.costPct));
            return (
              <tr key={it.id}>
                <td><input type="checkbox" name={'sel_' + it.id} /><input type="hidden" name={'o_' + it.id} value={`${r}|${r === 'prod' ? cp : ''}|${r === 'prod' ? pc : ''}`} /></td>
                <td>{it.code}</td><td>{it.name}</td><td>{it.unit}</td><td className="n">{it.price ? fmt(it.price) : ''}</td>
                <td><select name={'role_' + it.id} defaultValue={r} style={{ width: 'auto' }}>{Retail.ART_ROLES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></td>
                <td className="mini">{kOf(r, it)}</td>
                <td className="n">{r === 'prod' && <input name={'cp_' + it.id} inputMode="decimal" defaultValue={cp} style={{ width: 90, textAlign: 'right' }} />}</td>
                <td className="n">{r === 'prod' && <input name={'pc_' + it.id} inputMode="decimal" defaultValue={pc} style={{ width: 60, textAlign: 'right' }} />}</td>
              </tr>
            );
          })}{!L.length && <tr><td colSpan={9} className="note">Нема артикли.</td></tr>}</tbody>
        </table></div>
      </ActionForm>
      <p className="note">Промените важат за нови документи по зачувувањето. За веќе внесени фактури: „Шеми за автоматско книжење“ → „Прекнижи“.</p>
    </>
  );
}
