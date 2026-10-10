'use client';
/**
 * „📥 Фактура со ставки од Excel“ (legacy `pxHTML` / `pxPick` / `pxMapGo` / `pxBuild` / `pxTpl` 17237–17376): read the
 * lines of a purchase invoice from a spreadsheet, map the columns, then open the purchase editor with the lines
 * (new articles are added to the catalogue when the invoice is saved).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { pxAuto, pxGroups, pxHeaderRow, pxLines, pxNum, type PxCol, type PxMap } from '@wise/core/sales';

export const PX_DRAFT_KEY = 'wise:pxDraft';
export interface PxDraft {
  imp: boolean; wh: string; number: string; date: string; partnerId: string; supplierName: string; currency: string; fx: string; fxAmt: number;
  stock: { itemId: string; name: string; code: string; barcode: string; qty: string; price: string; sp: string; rate: string }[];
  groups: { account: string; rate: string; base: string; vat: string }[];
}
type Raw = { A: unknown[][]; hi: number; col: PxMap; file: string; err?: string };

const isoOf = (v: string) => { const m = v.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : /^\d{4}-\d\d-\d\d$/.test(v.trim()) ? v.trim() : ''; };

export function PxImport({ locations, partners, items, vatFirm, konto, closeHref, imp0 }: {
  locations: { id: string; name: string; kind: string }[];
  partners: { id: string; name: string }[];
  items: { id: string; code: string | null; name: string; rate: number; barcodes: string[] }[];
  vatFirm: boolean; konto: { warehouse: string; store: string };
  closeHref: string;
  /** Opened as „увозна“ (legacy UVH `pximp`). */
  imp0?: boolean;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10).split('-').reverse().join('.');
  const [imp, setImp] = useState(!!imp0);
  const [wh, setWh] = useState(locations[0]?.id ?? '');
  const [no, setNo] = useState('');
  const [dt, setDt] = useState(today);
  const [pn, setPn] = useState('');
  const [cur, setCur] = useState('EUR');
  const [fx, setFx] = useState('61.5');
  const [raw, setRaw] = useState<Raw | null>(null);
  const [msg, setMsg] = useState('');

  const build = (r: Raw) => {
    const L = pxLines(r.A, r.hi, r.col, vatFirm);
    if (!L.length) { setMsg('Нема ставки со количина – проверете ја колоната Количина.'); return; }
    if (!L.some((x) => Number(x.price) > 0)) {
      const H = (r.A[r.hi] ?? []).map((x) => String(x ?? ''));
      setRaw({ ...r, err: `Колоната за цена ${r.col.price != null ? '„' + (H[r.col.price] ?? '') + '“' : ''} нема бројки (примери: ${r.A.slice(r.hi + 1, r.hi + 4).map((x) => String(r.col.price != null ? x[r.col.price] ?? '' : '—')).join(' · ')}). Изберете ја вистинската колона.` });
      setMsg('Цените во девизи се празни – проверете ја колоната.');
      return;
    }
    const byCode = (c: string) => items.find((i) => (i.code ?? '') === c || i.barcodes.includes(c));
    const byName = (nm: string) => items.find((i) => i.name.trim().toLowerCase() === nm.toLowerCase());
    const M = L.map((x) => { const it = (x.code && byCode(x.code)) || (x.name && byName(x.name)) || null; return { x, it }; });
    const store = locations.find((l) => l.id === wh)?.kind === 'store';
    const g = pxGroups(M.map(({ x, it }) => ({ ...x, itemRate: it?.rate })), { imp, fx: pxNum(fx), vatFirm, konto: store ? konto.store : konto.warehouse });
    const pid = partners.find((p) => p.name.trim().toLowerCase() === pn.trim().toLowerCase())?.id ?? '';
    const d: PxDraft = {
      imp, wh, number: no, date: isoOf(dt), partnerId: pid, supplierName: pid ? '' : pn.trim(), currency: cur.toUpperCase(), fx: String(pxNum(fx)), fxAmt: g.fxAmt,
      stock: M.map(({ x, it }) => ({ itemId: it?.id ?? '', name: it?.name ?? (x.name || 'Артикл ' + x.code), code: x.code, barcode: x.barcode, qty: String(x.qty), price: String(x.price), sp: x.sp ? String(x.sp) : '', rate: String(x.rate) })),
      groups: g.groups.map((y) => ({ account: y.account, rate: String(y.rate), base: String(y.base), vat: String(y.vat) })),
    };
    try { sessionStorage.setItem(PX_DRAFT_KEY, JSON.stringify(d)); } catch { setMsg('Прелистувачот не дозволува привремено чување.'); return; }
    const mk = M.filter((m) => !m.it).length;
    router.push(`/vlez?${imp ? 'imp' : 'nov'}&px=${encodeURIComponent(`Увезени ${L.length} ставки${mk ? ' · ' + mk + ' нови артикли (се креираат при зачувување)' : ''}. Внесете добавувач, број и датум и зачувајте.`)}`);
  };

  const pick = () => {
    if (imp && !(pxNum(fx) > 0)) { setMsg('Внесете курс.'); return; }
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = '.xlsx,.xls,.csv,.ods,.txt';
    i.onchange = async () => {
      const f = i.files?.[0];
      if (!f) return;
      try {
        const XLSX = await import('xlsx');
        // FIX (LEGACY-MAP 3.4 item 19): cached cell values only, no formula evaluation with Function()
        const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
        let best: { A: unknown[][]; hi: number; sc: number } | null = null;
        for (const sn of wb.SheetNames) {
          const A = (XLSX.utils.sheet_to_json(wb.Sheets[sn]!, { header: 1, raw: true }) as unknown[][]).filter((r) => r && r.some((x) => String(x ?? '').trim()));
          if (!A.length) continue;
          const h = pxHeaderRow(A);
          if (!best || h.score > best.sc) best = { A, hi: h.hi, sc: h.score };
        }
        if (!best) { setMsg('Датотеката е празна.'); return; }
        const col = pxAuto(best.A[best.hi] ?? [], best.A.slice(best.hi + 1));
        const r: Raw = { A: best.A, hi: best.hi, col, file: f.name };
        if ((col.code == null && col.name == null) || col.qty == null || col.price == null || col._guess) {
          setRaw(r);
          setMsg(col.price == null ? 'Не е пронајдена колона со набавна / девизна цена – изберете ја рачно.' : 'Проверете ги колоните и потврдете.');
          return;
        }
        build(r);
      } catch (e) { setMsg('Датотеката не може да се прочита: ' + ((e as Error).message || e)); }
    };
    i.click();
  };
  const template = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([imp ? ['Шифра', 'Назив на производ', 'Количина', 'Цена во девизи', 'Продажна цена (ден)', 'ДДВ %'] : ['Шифра', 'Назив на производ', 'Количина', 'Набавна цена (ден)', 'Продажна цена (ден)', 'ДДВ %']]), 'Ставки');
    XLSX.writeFile(wb, imp ? 'Uvozna_faktura_stavki.xlsx' : 'Domasna_faktura_stavki.xlsx');
  };
  const H = raw ? (raw.A[raw.hi] ?? []).map((x, i) => String(x ?? '') || 'Колона ' + (i + 1)) : [];
  const sel = (k: PxCol, lab: string) => (
    <label className="f">{lab}<select value={raw?.col[k] ?? ''} onChange={(e) => raw && setRaw({ ...raw, col: { ...raw.col, [k]: e.target.value === '' ? undefined : Number(e.target.value) } })}>
      <option value="">— нема —</option>{H.map((x, i) => <option key={i} value={i}>{x.slice(0, 30)} ({String(raw?.A[raw.hi + 1]?.[i] ?? '').slice(0, 14)})</option>)}</select></label>
  );
  return (
    <div className="card" id="pxBox" style={{ borderColor: 'var(--accent)' }}>
      <div className="hd"><h2>📥 Влезна фактура со ставки од Excel</h2><Link className="btn sm" href={closeHref}>Затвори</Link></div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="chk"><input type="radio" checked={!imp} onChange={() => setImp(false)} /> Домашна (набавна цена во денари)</label>
        <label className="chk"><input type="radio" checked={imp} onChange={() => setImp(true)} /> Увозна – од странство (цена во девизи)</label>
        <label className="f">Објект<select value={wh} onChange={(e) => setWh(e.target.value)}><option value="">01 Главен магацин</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="f" style={{ width: 150 }}>Број на фактура<input value={no} onChange={(e) => setNo(e.target.value)} /></label>
        <label className="f" style={{ width: 130 }}>Датум<input inputMode="numeric" placeholder="ДД.ММ.ГГГГ" value={dt} onChange={(e) => setDt(e.target.value)} /></label>
        <label className="f" style={{ minWidth: 240, flex: 1 }}>Добавувач (комитент)<input list="px_pl" value={pn} placeholder="почнете да пишувате…" onChange={(e) => setPn(e.target.value)} /><datalist id="px_pl">{partners.slice(0, 800).map((p) => <option key={p.id} value={p.name} />)}</datalist></label>
        {imp && <><label className="f" style={{ width: 90 }}>Валута<input value={cur} onChange={(e) => setCur(e.target.value)} /></label><label className="f" style={{ width: 110 }}>Курс<input inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} /></label></>}
      </div>
      <p className="note">Колони: <b>Шифра</b>, <b>Назив на производ</b>, <b>Количина</b>, {imp ? <><b>Цена во девизи</b> (набавна од странство)</> : <><b>Набавна цена</b> (ден, без ДДВ)</>}, <b>Продажна цена</b> (ден, внатре) и по избор ДДВ %. Артиклите што ги нема во шифрарникот се креираат автоматски. После увозот се отвора фактурата – внесете добавувач, број, датум{imp ? ', царина и трошоци' : ''} и зачувајте (се книжи налог, лагер, картица{imp ? ', калкулација со курс' : ''}).</p>
      {raw && <>{raw.err && <div className="callout bad" style={{ margin: '8px 0' }}>{raw.err}</div>}
        <div className="callout warn" style={{ margin: '8px 0' }}><b>{raw.file}</b> – поврзете ги колоните (насловите се во ред {raw.hi + 1}):
          <div className="form" style={{ marginTop: 6 }}>{sel('code', 'Шифра')}{sel('name', 'Назив')}{sel('qty', 'Количина *')}{sel('price', imp ? 'Цена во девизи' : 'Набавна цена')}{sel('sp', 'Продажна цена (ден)')}{sel('rate', 'ДДВ %')}</div>
          <div className="row" style={{ marginTop: 6 }}><button type="button" className="btn pri" onClick={() => {
            if ((raw.col.code == null && raw.col.name == null) || raw.col.qty == null) { setMsg('Поврзете ја барем Шифра (или Назив) и Количина.'); return; }
            build({ ...raw, err: undefined });
          }}>Увези ги ставките</button></div></div></>}
      <div className="row" style={{ gap: 8 }}><button type="button" className="btn pri" onClick={pick}>📂 Избери Excel датотека</button><button type="button" className="btn" onClick={() => void template()}>⬇ Образец</button></div>
      {msg && <div className="note">{msg}</div>}
    </div>
  );
}
