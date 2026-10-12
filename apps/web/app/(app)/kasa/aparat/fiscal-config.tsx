'use client';
/** Device configuration form (talks only to the desktop app through `window.wiseFiscal`). */
import { useEffect, useState } from 'react';
import { DESKTOP_ONLY, fiscalBridge, safeCall, type FiscalConfig, type FiscalInfo, type FiscalStatus, type WiseFiscal } from '@/lib/fiscal-bridge';

const HELP: Record<string, string> = {
  serial: 'Апаратот е поврзан со кабел (RS232 или USB-сериски адаптер). Изберете ја COM портата (Управител на уреди → Порти).',
  tcp: 'Апаратот е во мрежа (LAN). Внесете ја IP адресата и портата од поставките на апаратот / од сервисот.',
  file: 'Програмата на производителот (на пр. Accent Fiscal32.exe) ја печати сметката. Изберете ја програмата или папката што ја следи сервисот.',
  sim: 'Симулатор: нема вистински апарат, сметките се запишуваат во датотека (за обука и демо).',
};

export function FiscalConfigForm() {
  const [b, setB] = useState<WiseFiscal | null | undefined>(undefined);
  const [info, setInfo] = useState<FiscalInfo | null>(null);
  const [c, setC] = useState<FiscalConfig | null>(null);
  const [pwd, setPwd] = useState('');
  const [ports, setPorts] = useState<{ path: string; name: string }[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const f = fiscalBridge();
    setB(f);
    if (!f) return;
    void (async () => {
      const [i, g, p] = await Promise.all([f.info(), f.getConfig(), f.listPorts().catch(() => ({ ok: false, ports: [] }))]);
      setInfo(i); if (g.config) setC(g.config); setPorts(p.ports ?? []);
    })();
  }, []);

  if (b === undefined) return null;
  if (!b) return <div className="card"><div className="callout warn" data-testid="fiscal-desktop-only">{DESKTOP_ONLY}</div></div>;
  if (!info || !c) return <div className="card"><div className="empty">Се вчитува…</div></div>;

  const V = info.vendors[c.vendor];
  const set = (p: Partial<FiscalConfig>) => setC({ ...c, ...p });
  const act = async (f: () => Promise<{ ok: boolean; error?: string; config?: FiscalConfig }>, okText: string) => {
    setBusy(true); setMsg(null);
    const r = await safeCall(f as () => Promise<{ ok: boolean; error?: string }>) as { ok: boolean; error?: string; config?: FiscalConfig };
    setBusy(false);
    if (r.config) setC(r.config);
    setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error || 'Грешка.' });
    return r;
  };
  const save = () => act(() => b.setConfig({
    vendor: c.vendor, model: c.model, driver: c.driver, port: c.port, baud: c.baud, host: c.host, tcpPort: c.tcpPort,
    op: c.op, till: c.till, fault: c.fault, ...(pwd ? { pwd } : {}),
  }), 'Поставките се зачувани на овој компјутер.');
  const status = async () => {
    setBusy(true); setMsg(null);
    const s = await safeCall(() => b.status()) as FiscalStatus;
    setBusy(false);
    setMsg(s.ok ? { ok: true, text: `✅ Апаратот одговара.${s.serial ? ' Сериски бр. ' + s.serial + '.' : ''}${(s.warnings ?? []).length ? ' ' + s.warnings!.join(' ') : ''}` }
      : { ok: false, text: s.error || (s.errors ?? []).join(' ') || 'Апаратот не одговара.' });
  };

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2>Поврзување</h2>
      {msg && <div className={'callout ' + (msg.ok ? 'good' : 'bad')} role="alert">{msg.text}</div>}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <label className="f">Производител
          <select value={c.vendor} onChange={(e) => { const v = info.vendors[e.target.value]; set({ vendor: e.target.value, model: v?.models[0] ?? '', driver: v?.drivers[0] ?? '', baud: v?.baud ?? 9600 }); }}>
            <option value="">— изберете —</option>
            {Object.entries(info.vendors).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></label>
        {V && <label className="f">Модел
          <select value={c.model} onChange={(e) => set({ model: e.target.value })}>{V.models.map((m) => <option key={m}>{m}</option>)}</select></label>}
        {V && V.drivers.length > 1 && <label className="f">Врска
          <select value={c.driver} onChange={(e) => set({ driver: e.target.value })}>{V.drivers.map((d) => <option key={d} value={d}>{info.drivers[d]}</option>)}</select></label>}
      </div>
      {c.driver && <p className="mini">{HELP[c.driver]}</p>}
      {c.driver === 'serial' && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="f">COM порта
            <input list="fiscalPorts" value={c.port} onChange={(e) => set({ port: e.target.value.toUpperCase() })} placeholder="COM1" style={{ width: 110 }} />
            <datalist id="fiscalPorts">{ports.map((p) => <option key={p.path} value={p.path}>{p.name}</option>)}</datalist></label>
          <label className="f">Брзина (baud)
            <select value={c.baud} onChange={(e) => set({ baud: Number(e.target.value) })}>{[9600, 19200, 38400, 57600, 115200].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
      )}
      {c.driver === 'tcp' && (
        <div className="row" style={{ gap: 10 }}>
          <label className="f">IP адреса<input value={c.host} onChange={(e) => set({ host: e.target.value.trim() })} placeholder="192.168.1.50" style={{ width: 150 }} /></label>
          <label className="f">Порта<input inputMode="numeric" value={c.tcpPort || ''} onChange={(e) => set({ tcpPort: Number(e.target.value) || 0 })} style={{ width: 90 }} /></label>
        </div>
      )}
      {c.driver === 'file' && (
        <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="f">Програма / папка<div className="mini">{c.exePath || '—'} · {c.folder || 'не е избрана'}</div></div>
          <button type="button" className="btn" disabled={busy} onClick={() => act(() => b.pickExe(), 'Програмата е избрана.')}>Избери програма (.exe)</button>
          <button type="button" className="btn" disabled={busy} onClick={() => act(() => b.pickFolder(), 'Папката е избрана.')}>Избери папка</button>
        </div>
      )}
      {c.vendor === 'sim' && (
        <label className="f">Симулирај грешка
          <select value={c.fault} onChange={(e) => set({ fault: e.target.value })}>
            <option value="">— без грешка —</option><option value="PAPER_OUT">Нема хартија</option><option value="NOT_CONNECTED">Не е поврзан</option>
            <option value="FM_FULL">Полна фискална меморија</option><option value="COVER_OPEN">Отворен капак</option>
          </select></label>
      )}
      {c.vendor && c.vendor !== 'sim' && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="f">Оператор (1–16)<input inputMode="numeric" value={c.op} onChange={(e) => set({ op: Number(e.target.value) || 1 })} style={{ width: 70 }} /></label>
          <label className="f">Лозинка на операторот<input type="password" autoComplete="off" placeholder={c.pwd ? 'непроменета' : '0000'} value={pwd} onChange={(e) => setPwd(e.target.value)} style={{ width: 130 }} /></label>
          <label className="f">Број на каса<input inputMode="numeric" value={c.till} onChange={(e) => set({ till: Number(e.target.value) || 1 })} style={{ width: 70 }} /></label>
        </div>
      )}
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button type="button" className="btn pri" disabled={busy || !c.vendor} onClick={save}>Зачувај</button>
        <button type="button" className="btn" disabled={busy || !c.vendor} onClick={status}>Статус</button>
        <button type="button" className="btn" disabled={busy || !c.vendor} onClick={() => act(() => b.test(), 'Тест печатењето е испратено (дијагностичка, нефискална сметка).')}>Тест печатење</button>
      </div>
      <p className="mini" style={{ marginTop: 10 }}>„Тест печатење“ печати дијагностички (нефискален) извештај. Поставките важат само за овој компјутер. Упатство: docs/FISKALNI-APARATI.md.</p>
    </div>
  );
}
