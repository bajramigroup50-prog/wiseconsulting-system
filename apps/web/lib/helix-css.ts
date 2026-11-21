/** The CSS of the Helix-style lists (`HelixShell`), a plain module so server pages can render it in a <style>. */
// layout only (WISE keeps its own colours and theme): the firm line, the current row, the menu, panel and bottom bar
export const HELIX_CSS = `
.hx-list .hx-firm{font-weight:800;font-size:20px;letter-spacing:.2px}
.hx-list table.hx-t{table-layout:fixed;width:100%;font-size:12px}
.hx-list table.hx-t th,.hx-list table.hx-t td,.hx-list table.hx-t.dense td,.hx-list table.hx-t.dense th{font-size:11.5px;padding:2px 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hx-list table.hx-t thead th,.hx-list table.hx-t.dense thead th{white-space:normal;line-height:1.15;vertical-align:bottom;font-size:10.5px;text-transform:none;letter-spacing:0;word-break:normal;overflow-wrap:normal;hyphens:manual;text-overflow:clip}
.hx-list table.hx-t td.hx-a{overflow:visible;white-space:nowrap}
.hx-list table.hx-t td.hx-a>.btn{margin-right:2px}
.hx-list table.hx-t td .pill{font-size:10.5px;padding:0 4px}
.hx-list table.hx-t td .btn.sm{padding:1px 5px;font-size:11px}
.hx-list .hx-act{position:relative;display:inline-block}
.hx-list .hx-act>summary{list-style:none;cursor:pointer}
.hx-list .hx-act>div{position:absolute;right:0;z-index:25;background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:6px;padding:4px;display:grid;gap:3px;min-width:170px;box-shadow:0 4px 14px rgba(0,0,0,.12)}
.hx-list .tw{overflow-x:auto}
.hx-list .hx-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start}
.hx-hd .hd{margin:0 0 2px;padding:0;min-height:0}
.hx-hd .hd h1{font-size:15px;margin:0;line-height:1.3}
.hx-list table.hx-t tbody tr[aria-selected=true]{outline:2px solid var(--accent);outline-offset:-2px;background:var(--accent-soft,rgba(31,94,255,.08))}
.hx-list table.hx-t tbody tr.hx-marked{background:var(--warn-bg,#fff7e0)}
.hx-list table.hx-t td.hx-mk{width:16px;font-weight:700;text-align:center;color:var(--accent)}
.hx-list .hx-menu{display:flex;flex-wrap:wrap;gap:2px;margin:0 0 6px;border-bottom:1px solid var(--line,#ddd)}
.hx-list .hx-menu details{position:relative}
.hx-list .hx-menu summary{list-style:none;cursor:pointer;padding:4px 10px;font-size:13px;border-radius:4px}
.hx-list .hx-menu summary:hover{background:var(--accent-soft,#e8eefc)}
.hx-list .hx-menu summary[aria-disabled=true]{color:var(--muted,#888);cursor:default}
.hx-list .hx-menu .hx-dd{position:absolute;z-index:30;left:0;top:100%;background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:6px;padding:4px;display:grid;gap:2px;min-width:230px;max-width:min(520px,90vw);box-shadow:0 4px 14px rgba(0,0,0,.12)}
.hx-list .hx-menu .hx-dd .hx-x{border-top:1px solid var(--line,#ddd);padding-top:6px;margin-top:4px;display:grid;gap:6px}
.hx-list .hx-menu .hx-dd .hx-sep{border-top:1px solid var(--line,#ddd)!important;margin-top:3px;padding-top:5px}
.hx-list .hx-menu .hx-dd{max-height:75vh;overflow:auto}
.hx-list .hx-menu .hx-dd > *{text-align:left;justify-content:flex-start}
.hx-list .hx-filter{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 6px}
.hx-list .hx-filter form{margin:0!important}
.hx-list .hx-panel{position:sticky;top:70px;align-self:flex-start;display:flex;flex-direction:column;gap:6px;padding:10px;min-width:150px;max-width:165px}
.hx-list .hx-panel .btn{font-size:12px;padding:4px 6px}
.hx-list .hx-panel .btn{justify-content:center;white-space:normal;text-align:center}
.hx-list .hx-panel fieldset{border:1px solid var(--line,#ddd);border-radius:6px;padding:6px;margin:4px 0 0;display:flex;flex-direction:column;gap:6px}
.hx-list .hx-panel legend{font-size:12px;color:var(--muted,#666);padding:0 4px}
.hx-list .hx-bottom{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px}
`;
