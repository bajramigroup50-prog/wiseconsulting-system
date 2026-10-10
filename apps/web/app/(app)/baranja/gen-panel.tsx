'use client';
/** Legacy `genPanel` / `formPanel` / `freeEditor` / `genDoc`: fill a request or an official form with live preview, print / PDF. */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PH, askFields, fSrcVal, fillTpl, formHtml, formVals, phVals, reqHtml, type ReqFirm, type ReqForm, type ReqTpl } from '@wise/core/firms/requests';
import { saveFirmFromForm } from './actions';

const memKey = (id: string) => 'frm_' + id;
const readMem = (id: string): Record<string, string> => { try { return JSON.parse(localStorage.getItem(memKey(id)) || '{}') as Record<string, string>; } catch { return {}; } };

function printHtml(title: string, html: string) {
  const w = window.open('', '_blank');
  if (!w) { window.alert('Дозволете скокачки прозорци за печатење.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>&]/g, '')}</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;margin:0}</style></head><body>${html}<script>window.onload=()=>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

export function GenPanel({ tp, firm, firmId, firms, today }: { tp: ReqTpl | ReqForm; firm: ReqFirm; firmId: string; firms: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const isForm = 'form' in tp && tp.form;
  const [ask, setAsk] = useState<Record<string, string>>({});
  const [free, setFree] = useState<{ to: string; title: string; body: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [mem, setMem] = useState<Record<string, string>>({});
  useEffect(() => setMem(readMem(tp.id)), [tp.id]);
  const A = isForm ? [] : askFields((tp as ReqTpl).title + ' ' + (tp as ReqTpl).body + ' ' + ((tp as ReqTpl).to ?? ''));
  const V = useMemo(() => (isForm ? formVals(tp as ReqForm, firm, ask, today, mem) : {}), [isForm, tp, firm, ask, today, mem]);
  const fr = free ?? (isForm ? null : { to: fillTpl((tp as ReqTpl).to || tp.inst || '', firm, ask, today), title: fillTpl((tp as ReqTpl).title, firm, ask, today), body: fillTpl((tp as ReqTpl).body, firm, ask, today) });
  const doc = (base = '') => (isForm ? formHtml(tp as ReqForm, V, { base }) : free ? reqHtml({ to: free.to, title: free.title, body: free.body }, firm, {}, today) : reqHtml(tp as ReqTpl, firm, ask, today));
  const F = isForm ? (tp as ReqForm).fields : [];
  const opts = F.filter((x) => x.t === 'c');
  const sel = opts.find((x) => V[x.k])?.k ?? '';
  const X = F.filter((x) => x.t === 'x');
  const groups = [...new Set(X.filter((x) => x.g).map((x) => x.g!))];
  const set = (k: string, v: string) => setAsk((p) => ({ ...p, [k]: v }));
  const hint = (src: string) => (src.startsWith('f.') ? (fSrcVal(src, firm, today) ? <small className="note"> (од фирмата)</small> : <small style={{ color: 'var(--bad)' }}> (фирмата нема – впишете, ќе се зачува)</small>) : null);
  const onPrint = async () => {
    if (isForm) {
      const mem: Record<string, string> = {};
      for (const x of F) if (!(x.src || '').startsWith('f.') && x.src !== 'today' && ask[x.k] != null) mem[x.k] = ask[x.k]!;
      try { localStorage.setItem(memKey(tp.id), JSON.stringify(mem)); } catch { /* private mode */ }
      const byKey = (src: string) => F.find((x) => x.src === src && String(ask[x.k] ?? '').trim())?.k;
      const vals: Record<string, string> = {};
      for (const [k, src] of [['signerEmbg', 'f.signerEmbg'], ['signer', 'f.signer'], ['email', 'f.email'], ['phone', 'f.phone'], ['edb', 'f.edb'], ['name', 'f.name'], ['activity', 'f.activity']] as const) { const kk = byKey(src); if (kk) vals[k] = ask[kk]!; }
      if (Object.keys(vals).length) { const r = await saveFirmFromForm(firmId, vals); if (r.ok) setMsg(r.ok); }
    }
    printHtml(tp.name, doc(window.location.origin));
  };
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="hd"><h2 style={{ margin: 0 }}>{tp.name}</h2><button type="button" className="btn" onClick={() => router.push('/baranja')}>✕</button></div>
      <div className="form">
        <label className="f wide">Фирма<select value={firmId} onChange={(e) => router.push(`/baranja?t=${encodeURIComponent(tp.id)}&src=${e.target.value}`)}>{firms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {A.map((k) => <label key={k} className="f wide">{k}<input value={ask[k] ?? ''} onChange={(e) => { set(k, e.target.value); setFree(null); }} /></label>)}
      </div>
      {isForm ? (
        <>
          <div className="form">
            {F.filter((x) => x.t === 'm').map((x) => <label key={x.k} className="f wide"><span>{x.l}{hint(x.src)}</span><textarea rows={3} value={V[x.k] ?? ''} onChange={(e) => set(x.k, e.target.value)} /></label>)}
            {F.filter((x) => x.t === 't').map((x) => <label key={x.k} className={`f ${x.w > 300 ? 'wide' : ''}`}><span>{x.l}{hint(x.src)}</span><input value={V[x.k] ?? ''} onChange={(e) => set(x.k, e.target.value)} /></label>)}
          </div>
          {X.length > 0 && (
            <div className="card" style={{ gap: 4, padding: 10 }}><b>Штиклирајте</b>
              {groups.map((g) => <div key={g} className="row" style={{ gap: 14, flexWrap: 'wrap' }}>{X.filter((x) => x.g === g).map((x) => <label key={x.k} className="chk"><input type="radio" name={'fx_' + g} checked={!!V[x.k]} onChange={() => setAsk((p) => ({ ...p, ...Object.fromEntries(X.filter((y) => y.g === g).map((y) => [y.k, y.k === x.k ? '1' : ''])) }))} /> {x.l}</label>)}</div>)}
              {X.filter((x) => !x.g).map((x) => <label key={x.k} className="chk"><input type="checkbox" checked={!!V[x.k]} onChange={(e) => set(x.k, e.target.checked ? '1' : '')} /> {x.l}</label>)}
            </div>
          )}
          {opts.length > 0 && (
            <div className="card" style={{ gap: 4, padding: 10 }}><b>Основ на барањето</b>
              {opts.map((x) => <label key={x.k} className="chk"><input type="radio" name="fopt" checked={sel === x.k} onChange={() => setAsk((p) => ({ ...p, ...Object.fromEntries(opts.map((y) => [y.k, y.k === x.k ? '1' : ''])) }))} /> {x.l}</label>)}
            </div>
          )}
        </>
      ) : (
        <details className="card" style={{ padding: 10 }} open={!!(tp as ReqTpl).free || !!free}>
          <summary><b>✎ Пишете / уредете го текстот сами</b> <span className="note">(за што Ви треба)</span></summary>
          <div className="form" style={{ marginTop: 8 }}>
            <label className="f wide">До (институција)<input value={fr!.to} onChange={(e) => setFree({ ...fr!, to: e.target.value })} /></label>
            <label className="f wide">Наслов<input value={fr!.title} onChange={(e) => setFree({ ...fr!, title: e.target.value })} /></label>
            <label className="f wide">Текст<textarea rows={9} value={fr!.body} onChange={(e) => setFree({ ...fr!, body: e.target.value })} /></label>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="mini">Вметни податок од фирмата:</span>
            {PH.map(([k, n]) => { const v = phVals(firm, today)[k] ?? ''; return <button key={k} type="button" className="btn sm" title={v} onClick={() => setFree({ ...fr!, body: fr!.body + v })}>+ {n}</button>; })}
          </div>
        </details>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn pri" onClick={onPrint}>🖨 Печати / PDF</button>
        {msg && <span className="mini">{msg}</span>}
      </div>
      <div className="pdfwrap"><div className="pdfdoc" dangerouslySetInnerHTML={{ __html: doc() }} /></div>
    </div>
  );
}
