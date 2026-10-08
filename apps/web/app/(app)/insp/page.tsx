/** Legacy `VIEWS.insp` 16537 → **16676** — readiness for УЈП / ДПИ / ДИТ inspections (40 checks). */
import { eq } from 'drizzle-orm';
import { INSP_G, inspCheck, inspCtx, inspScore, type InspManual, type InspProfile, type InspS } from '@wise/core/office';
import { buildFirmSnapshot, inspectionStates } from '@wise/db';
import { db } from '@/lib/db';
import { officePage, today } from '@/lib/office';
import { hrefFor } from '@/lib/nav';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { inspPdf, saveInspProfile, setInspState } from './actions';

const PILL: Record<InspS, [string, string]> = { ok: ['good', '✓ во ред'], bad: ['bad', '✕ проблем'], warn: ['warn', '! провери'], todo: ['info', '? потврди'], na: ['', '— не се однесува'] };

export default async function InspPage({ searchParams }: { searchParams: Promise<{ pdf?: string }> }) {
  const sp = await searchParams;
  const { firm } = await officePage('insp', { perm: 'office' });
  if (!firm) return <NoFirm t="🕵 Подготвеност за инспекција" />;
  const prof = (firm.settings as { inspProf?: InspProfile }).inspProf ?? {};
  const [snap, man] = await Promise.all([buildFirmSnapshot(db(), firm.id), db().select().from(inspectionStates).where(eq(inspectionStates.firmId, firm.id))]);
  const M: Record<string, InspManual> = Object.fromEntries(man.map((m) => [m.itemId, { d: m.doneDate, na: m.na, by: m.byName, note: m.note }]));
  const c = inspCtx(snap!, prof);
  const R = inspCheck(c, M);
  const sc = inspScore(R);
  return (
    <>
      <Hd t="🕵 Подготвеност за инспекција" sub={`${firm.name} · ${sc.pct}%`}>
        <RowAction className="btn" action={inspPdf} label="⬇ PDF (сервер)" />
      </Hd>
      {sp.pdf && <div className="callout">PDF се подготвува… <a href={`/api/files/${sp.pdf}`} target="_blank" rel="noopener">Отвори PDF</a> (ако не се отвори, обидете се повторно за неколку секунди).</div>}
      <div className="tiles">
        <div className="tile"><span>Подготвеност</span><b>{sc.pct}%</b></div>
        <div className="tile"><span>Проблеми</span><b style={{ color: 'var(--bad)' }}>{sc.bad}</b></div>
        <div className="tile"><span>За проверка</span><b>{sc.warn}</b></div>
        <div className="tile"><span>За потврда</span><b>{sc.todo}</b></div>
      </div>
      <ActionForm action={saveInspProfile} reset={false} className="card row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <span className="mini">Дејност (НКД): {c.codes.join(', ') || '—'} · вработени: {c.n}</span>
        <label className="chk"><input type="checkbox" name="fisk" defaultChecked={c.fisk} /> Фискален апарат</label>
        <label className="chk"><input type="checkbox" name="alc" defaultChecked={!!prof.alc} /> Продава алкохол / цигари</label>
        <label className="chk"><input type="checkbox" name="web" defaultChecked={!!prof.web} /> Веб-продажба</label>
        <label className="f" style={{ maxWidth: 200 }}>Благајнички максимум<input name="kasaMax" inputMode="decimal" defaultValue={prof.kasaMax ?? ''} /></label>
        <button className="btn sm">Зачувај</button>
      </ActionForm>
      {INSP_G.map(([g, t]) => {
        const rows = R.filter((r) => r.it.g === g);
        if (!rows.length) return null;
        return (
          <div key={g} className="card">
            <h2 style={{ fontSize: 15 }}>{t}</h2>
            <div className="tw"><table className="dense"><tbody>
              {rows.map((r) => (
                <tr key={r.it.id}>
                  <td style={{ whiteSpace: 'nowrap' }}><Pill c={PILL[r.s][0]}>{PILL[r.s][1]}</Pill></td>
                  <td><b>{r.t}</b><div className="mini" style={{ display: 'block' }}>{r.it.law}{r.it.fine ? ` · казна: ${r.it.fine}` : ''}</div>
                    <div className="mini" style={{ display: 'block' }}>Доказ: {r.it.ev}</div></td>
                  <td>{r.txt}{r.go && <> <a className="mini" href={hrefFor(r.go)}>→ отвори</a></>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.it.man && (
                      <ActionForm action={setInspState} className="row" style={{ gap: 4 }}>
                        <input type="hidden" name="itemId" value={r.it.id} />
                        <input type="date" name="d" defaultValue={M[r.it.id]?.d ?? today()} style={{ width: 140 }} />
                        <button className="btn sm" name="op" value="ok">✓</button>
                        <button className="btn sm ghost" name="op" value="na" title="Не се однесува">—</button>
                        {M[r.it.id] && <button className="btn sm ghost" name="op" value="clear" title="Поништи">↺</button>}
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody></table></div>
          </div>
        );
      })}
      <p className="note">Автоматските проверки за плати, ДДВ, фискални и излезни фактури се вклучуваат кога тие модули ќе бидат пренесени; дотогаш означете ги рачно.</p>
    </>
  );
}
