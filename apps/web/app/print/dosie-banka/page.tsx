/**
 * 🏦 Досие за банка (Анализи → „🏦 Досие за банка“): one A4 page for a credit talk — firm header, short balance
 * (assets / liabilities / equity, revenue / result of the year to date), the health grade A–E with Altman Z'', the
 * 13-week cash forecast and the financial ratios. Same numbers as the tabs „Паричен тек“, „Финансиско здравје“ and
 * „Финансиски показатели“ (`cashForecast`, `ratios`, `healthScore`); cash assumptions from the URL (`lp`, `ot`).
 */
import { anDays, cashForecast, dashAgg, healthScore, ratios } from '@wise/core/analysis';
import { loadAnalysis, loadFinance } from '@/lib/analysis';
import { dmy, fmt } from '@/lib/fmt';
import { todayIso } from '@/lib/stock';
import { FirmHead, Sig } from '../firm-head';
import { printGuard } from '../guard';

export const metadata = { title: 'Досие за банка' };

const CSS = '.pdfdoc .dz-g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pdfdoc .dz-b{border:1px solid #ccd;border-radius:8px;padding:8px 10px;break-inside:avoid}.pdfdoc .dz-b h3{margin:0 0 6px;font-size:12.5px}.pdfdoc table.dz td,.pdfdoc table.dz th{padding:2px 5px;font-size:10.5px}.pdfdoc .dz-gr{width:74px;height:74px;border-radius:14px;color:#fff;display:grid;place-items:center;font-size:44px;font-weight:800;flex:0 0 auto}';
const c2 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const pc = (x: number | null | undefined) => (x == null ? '—' : `${String(x).replace('.', ',')}%`);
const dn = (x: number | null | undefined) => (x == null ? '—' : `${x} дена`);

export default async function DosieBanka({ searchParams }: { searchParams: Promise<{ lp?: string; ot?: string }> }) {
  const sp = await searchParams;
  const { firm, year } = await printGuard('analizi');
  const today = todayIso();
  const lp = [0, 25, 50, 75, 100].includes(Number(sp.lp)) ? Number(sp.lp) : 50;
  const ot = Math.max(0, Math.round(Number(String(sp.ot ?? '').replace(/[\s.]/g, '').replace(',', '.')) || 0));
  const [F, D] = await Promise.all([loadFinance(firm, year, today), loadAnalysis(firm)]);
  const C = cashForecast({ today, start: F.start, invoices: D.invDocs, purchases: D.purDocs, vat: F.vat ? { amount: F.vat.amount, due: F.vat.due } : null, payroll: F.payroll, lateShare: lp / 100, otherMonthly: ot, fmt });
  const min = C.wk.reduce((m, w) => (w.bal < m.bal ? { bal: w.bal, from: w.from } : m), { bal: C.start, from: today });
  const sIn = Math.round(C.wk.reduce((a, w) => a + w.inn, 0) * 100) / 100, sOut = Math.round(C.wk.reduce((a, w) => a + w.out, 0) * 100) / 100;
  const rg = { from: `${year}-01-01`, to: today.startsWith(String(year)) ? today : `${year}-12-31` };
  const pur = D.purDocs.filter((p) => p.date >= rg.from && p.date <= rg.to).reduce((a, p) => a + p.total, 0);
  const R = ratios({ balance: F.balance, agg: dashAgg(F.lines, rg.from, rg.to), purchases: pur, days: anDays(rg, today) });
  const H = healthScore({ balance: F.balance, r: R, minBal: min.bal, avgOut: sOut / 13 });
  const gc = { A: '#1f8a4c', B: '#5aa05a', C: '#c99700', D: '#e07b20', E: '#c0392b' }[H.grade];
  const zl = { safe: 'сигурна зона', grey: 'сива зона', distress: 'зона на ризик' } as const;
  const fixedA = Math.round(Object.entries(F.balance).filter(([k]) => /^0/.test(k)).reduce((a, [, v]) => a + v, 0) * 100) / 100;
  const ltl = Math.round(-Object.entries(F.balance).filter(([k]) => /^2[0-1]/.test(k)).reduce((a, [, v]) => a + v, 0) * 100) / 100;
  const Row = ({ n, v, b }: { n: string; v: React.ReactNode; b?: boolean }) => <tr><td>{b ? <b>{n}</b> : n}</td><td className="n">{b ? <b>{v}</b> : v}</td></tr>;
  return (
    <div className="pdfdoc">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <FirmHead firm={firm} title="ФИНАНСИСКО ДОСИЕ ЗА БАНКА" sub={`Состојба од книговодството за ${year} · ${dmy(rg.from)} – ${dmy(rg.to)}`} />
      <div className="dz-g">
        <div className="dz-b"><h3>Биланс – кратко</h3>
          <table className="dz"><tbody>
            <Row n="Вкупен имот" v={fmt(H.ta)} b />
            <Row n="  од тоа постојан имот (класа 0)" v={fmt(fixedA)} />
            <Row n="  тековен имот (пари, побарувања, залиха)" v={fmt(R.ca)} />
            <Row n="  пари на сметка и благајна" v={fmt(R.cash)} />
            <Row n="Обврски" v={fmt(H.liab)} b />
            <Row n="  краткорочни обврски" v={fmt(R.cl)} />
            <Row n="  долгорочни обврски (20–21)" v={fmt(ltl)} />
            <Row n="Капитал (со тековниот резултат)" v={fmt(H.equity)} b />
            <Row n="Приходи (од почеток на годината)" v={fmt(R.rev)} b />
            <Row n="Резултат пред данок" v={fmt(R.res)} b />
          </tbody></table>
        </div>
        <div className="dz-b"><h3>Финансиско здравје</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="dz-gr" style={{ background: gc }}>{H.grade}</div>
            <div><b style={{ fontSize: 14 }}>{H.label} · {H.score} / 100</b><br />
              Altman Z&apos;&apos;: <b>{H.z != null ? c2(H.z) : '—'}</b>{H.zZone ? ` (${zl[H.zZone]})` : ''}<br />
              <span className="mini">Z&apos;&apos; над 5,85 сигурно · 4,35 – 5,85 сива зона · под 4,35 ризик</span></div>
          </div>
          <table className="dz" style={{ marginTop: 6 }}><tbody>
            {H.parts.map((p) => <tr key={p.key}><td>{p.name}</td><td className="n">{p.value}</td><td className="n">{p.score == null ? 'н/п' : `${String(p.score).replace('.', ',')} / ${p.max}`}</td></tr>)}
          </tbody></table>
        </div>
        <div className="dz-b"><h3>Финансиски показатели</h3>
          <table className="dz"><tbody>
            <Row n="Тековна ликвидност (норма > 1,5)" v={c2(R.cur)} />
            <Row n="Брза ликвидност (норма > 1,0)" v={c2(R.quick)} />
            <Row n="Парична ликвидност (0,2 – 0,5)" v={c2(R.cashR)} />
            <Row n="Денови на наплата – DSO (до 45)" v={dn(R.dso)} />
            <Row n="Денови на плаќање – DPO" v={dn(R.dpo)} />
            <Row n="Денови на залиха – DIO" v={dn(R.dio)} />
            <Row n="Готовински циклус – CCC" v={dn(R.ccc)} />
            <Row n="Бруто маржа" v={pc(R.gm)} />
            <Row n="Нето маржа" v={pc(R.nm)} />
            <Row n="Точка на рентабилност (месечно)" v={R.beM != null ? fmt(R.beM) : '—'} />
            <Row n="Обврски / капитал" v={H.equity > 0 ? c2(Math.round(H.liab / H.equity * 100) / 100) : '—'} />
          </tbody></table>
        </div>
        <div className="dz-b"><h3>Паричен тек · следни 13 недели</h3>
          <table className="dz"><thead><tr><th>Нед.</th><th>Од</th><th className="n">Приливи</th><th className="n">Одливи</th><th className="n">Состојба</th></tr></thead><tbody>
            <tr><td>—</td><td>денес</td><td /><td /><td className="n"><b>{fmt(C.start)}</b></td></tr>
            {C.wk.map((w, i) => <tr key={i}><td>{i + 1}</td><td>{dmy(w.from).slice(0, 5)}</td><td className="n">{fmt(w.inn)}</td><td className="n">{fmt(w.out)}</td>
              <td className="n" style={{ color: w.bal < 0 ? '#c0392b' : undefined }}>{fmt(w.bal)}</td></tr>)}
            <tr><td colSpan={2}><b>Вкупно</b></td><td className="n"><b>{fmt(sIn)}</b></td><td className="n"><b>{fmt(sOut)}</b></td><td className="n"><b>{fmt(C.wk[C.wk.length - 1]?.bal ?? C.start)}</b></td></tr>
          </tbody></table>
          <p className="mini" style={{ margin: '4px 0 0' }}>Приливи по рок на излезните фактури (+ {lp}% од задоцнетите {fmt(C.lateIn)} во 4 недели); одливи: добавувачи, ДДВ, плати{ot ? `, други ${fmt(ot)} месечно` : ''}. Најниска состојба {fmt(min.bal)} ({dmy(min.from)}).</p>
        </div>
      </div>
      {(H.good.length > 0 || H.bad.length > 0) && <div className="dz-g" style={{ marginTop: 10 }}>
        <div className="dz-b"><h3>✅ Силни страни</h3>{H.good.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{H.good.map((x) => <li key={x}>{x}</li>)}</ul> : '—'}</div>
        <div className="dz-b"><h3>⚠️ Ризици</h3>{H.bad.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{H.bad.map((x) => <li key={x}>{x}</li>)}</ul> : 'Нема посебни ризици.'}</div>
      </div>}
      <p className="mini" style={{ marginTop: 8 }}>Податоците се од книговодството на фирмата (неревидирани, без затворање на годината) и прогнозата на паричниот тек од отворените фактури. Оценката A–E е ориентациона.</p>
      <Sig who={['Составил (сметководител)', 'Одговорно лице']} />
    </div>
  );
}
