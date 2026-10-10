/**
 * Legacy `VIEWS.ujpZakoni` 16787 — 📚 Закони на УЈП – синхронизирано: every law area administered by УЈП with its
 * consolidated texts (link to ujp.gov.mk), the program screens that apply it, the automatic checks (tax review rules +
 * inspection checks) with the selected firm's ⛔ / ⚠ counts, and the latest changes found by the daily law robot.
 */
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { inspCheck, inspCtx, type InspManual, type InspProfile, type InspRow } from '@wise/core/office';
import { UJP_AREAS, ujpAreaChanges, ujpAreaFindings, ujpAreaRules, ujpTotalChecks, type LrResult } from '@wise/core/law';
import { buildFirmSnapshot, inspectionStates, lawReview } from '@wise/db';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { loadLaw } from '@/lib/law';
import { hrefFor, NAV_LBL } from '@/lib/nav';
import { officePage, today } from '@/lib/office';
import { Hd } from '@/components/hd';

export default async function UjpZakoniPage() {
  const { firm } = await officePage('ujpZakoni');
  const year = await currentYear();
  const law = await loadLaw();
  let X: LrResult | null = null, Y: InspRow[] | null = null;
  if (firm) {
    try {
      X = await lawReview(db(), firm, year, today());
      const [snap, man] = await Promise.all([buildFirmSnapshot(db(), firm.id), db().select().from(inspectionStates).where(eq(inspectionStates.firmId, firm.id))]);
      const M: Record<string, InspManual> = Object.fromEntries(man.map((m) => [m.itemId, { d: m.doneDate, na: m.na, by: m.byName, note: m.note }]));
      Y = inspCheck(inspCtx(snap!, (firm.settings as { inspProf?: InspProfile }).inspProf ?? {}), M);
    } catch (e) { console.warn('ujpZakoni', e); X = null; Y = null; }
  }
  return (
    <>
      <Hd t="📚 Закони на УЈП – синхронизирано" sub={`${UJP_AREAS.length} области · ${ujpTotalChecks()} автоматски проверки${firm ? ' · ' + firm.name : ''}`}>
        <Link className="btn" href="/lawrep">⚖️ Даночен преглед</Link>
        <Link className="btn" href="/zakoni">⚖️ Законски промени</Link>
      </Hd>
      <div className="callout" style={{ fontSize: 12.5 }}>Секој закон што го спроведува УЈП е поврзан со делот од програмата што го применува и со автоматските проверки (член → правило → книжења). Дневниот робот „⚖️ Законски промени“ секое утро ги пребарува УЈП и Службен весник; кога ќе има измена, тука се појавува кај соодветниот закон, а правилото се ажурира.</div>
      {UJP_AREAS.map((a) => {
        const { R, I } = ujpAreaRules(a);
        const ch = ujpAreaChanges(a, law);
        const fr = X && Y ? ujpAreaFindings(a, X, Y) : null;
        return (
          <div key={a.k} className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>{a.n}</h2>
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                {fr && <>
                  {fr.bad > 0 && <span className="pill bad">⛔ {fr.bad}</span>}
                  {fr.warn > 0 && <span className="pill warn">⚠ {fr.warn}</span>}
                  {!fr.bad && !fr.warn && (R.length > 0 || I.length > 0) && <span className="pill good">✓ во ред</span>}
                </>}
                <a className="btn sm" href={a.url} target="_blank" rel="noopener">📄 Текст и прописи (УЈП)</a>
              </div>
            </div>
            {a.note && <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5 }}>{a.note}</p>}
            <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginTop: 6, fontSize: 12.5, alignItems: 'flex-start' }}>
              {(a.prog ?? []).length > 0 && (
                <div style={{ minWidth: 220 }}><b>Во програмот:</b>
                  {a.prog!.map(([v, t]) => <div key={v}>{NAV_LBL[v] ? <Link href={hrefFor(v)}>{t}</Link> : <span className="muted" title="сè уште не е пренесено">{t}</span>}</div>)}
                </div>
              )}
              {(R.length > 0 || I.length > 0) && (
                <div style={{ flex: 1, minWidth: 280 }}><b>Автоматски проверки ({R.length + I.length}):</b>
                  {[...R.map((r) => `⚖️ ${r.t} – ${r.art}`), ...I.map((i) => '🛡 ' + (typeof i.t === 'function' ? i.t({ n: 0 } as Parameters<typeof i.t>[0]) : i.t))].map((t) => <div key={t}>{t}</div>)}
                </div>
              )}
              <div style={{ minWidth: 220 }}><b>Последни промени:</b>
                {ch.length ? ch.map((x) => <div key={x.id}>{x.date ? dmy(x.date) + ' · ' : ''}{x.title.slice(0, 90)}</div>) : <div className="muted">нема нови (роботот проверува секое утро)</div>}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
