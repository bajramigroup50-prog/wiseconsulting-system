/**
 * The legacy print CSS (`PDF_CSS`, legacy line 3204, plus the 12866 `.pdfdoc` additions) for HTML rendered outside the
 * browser page — server PDFs in the worker (`invoice.mail`). Verbatim copy of `apps/web/app/legacy-injected.css`
 * lines 4–29 and 65; `print-css.test.ts` fails if the two drift apart.
 */
export const PDFDOC_CSS = `
.kart{border:1.5px solid #111;margin-top:8px}.kart th{background:#fff!important;color:#111!important;border:1px solid #111!important;font-size:11px;letter-spacing:.04em}.kart td{border:0!important;border-left:1px solid #111!important;padding:3px 5px}.kart tfoot td{border-top:1.5px solid #111!important;font-weight:700;border-left:0!important}
.pdfdoc{width:190mm;background:#fff;color:#111;font-family:"IBM Plex Sans",Arial,sans-serif;font-size:10.5px;line-height:1.35}
.pdfdoc.land{width:277mm}
.pdfdoc h1{font-size:18px;margin:0 0 2px;font-family:Arial,"IBM Plex Sans",sans-serif;font-weight:400;color:#111}
.pdfdoc h2{font-size:12.5px;margin:12px 0 4px;color:#111}
.pdfdoc .fh{font-family:Arial,"IBM Plex Sans",sans-serif;margin-bottom:6px}
.pdfdoc .fh .fn{font-size:20px;font-weight:700;letter-spacing:.01em;border-bottom:4px double #111;padding-bottom:2px}
.pdfdoc .fh .fa{text-align:center;font-size:9.5px;margin-top:3px;line-height:1.35}
.pdfdoc .ph{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin:4px 0 8px;font-family:Arial,sans-serif}
.pdfdoc .ph .pt{font-size:18px}.pdfdoc .ph .ps{font-size:11px;margin-top:1px}
.pdfdoc .ph .pm{text-align:right;font-size:9.5px;color:#333;white-space:nowrap}
.pdfdoc small,.pdfdoc .muted{color:#444}
.pdfdoc table{width:100%;border-collapse:collapse;font-size:10px;margin:4px 0;border:1.5px solid #111}
.pdfdoc th,.pdfdoc td{padding:2.5px 5px;vertical-align:top;color:#111;background:#fff}
.pdfdoc td{border:0;border-left:1px solid #111;border-bottom:.5px solid #d6d6d6}
.pdfdoc th{border:1px solid #111;background:#fff;text-transform:none;letter-spacing:.03em;font-size:9.5px;font-weight:700;text-align:left;white-space:normal;vertical-align:middle}
.pdfdoc thead th{background:#fff}
.pdfdoc td.n,.pdfdoc th.n{text-align:right;font-family:"IBM Plex Mono",Consolas,monospace;white-space:nowrap}
.pdfdoc tr.sub td{background:#efefef;font-weight:700;border-top:1px solid #111;border-bottom:1px solid #111}
.pdfdoc tr.tot td,.pdfdoc tfoot td{font-weight:700;background:#fff;border-top:1.5px solid #111;border-left:0}
.pdfdoc tfoot td.n,.pdfdoc tr.tot td.n{border-left:1px solid #111}
.pdfdoc .pb{page-break-before:always}
.pdfdoc .sig{display:flex;justify-content:space-between;margin-top:30px;gap:20px}
.pdfdoc .sig span{border-top:1px solid #111;padding-top:3px;min-width:50mm;text-align:center}
.pdfdoc .box{border:1px solid #111;padding:6px 8px;margin:6px 0}
.pdfdoc .grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}.pdfdoc .sigimg{margin-top:30mm!important;overflow:visible!important}.pdfdoc .sigimg span{position:relative}.pdfdoc .sgi{position:absolute;left:50%;bottom:calc(100% - 3mm);transform:translateX(-50%);max-height:17mm;max-width:48mm}.pdfdoc .sti{position:absolute;left:50%;bottom:calc(100% - 17mm);transform:translateX(-50%);max-height:40mm;max-width:40mm;opacity:.92;z-index:2;pointer-events:none}
.pdfdoc .tw{overflow:visible!important;border:0!important;background:none!important;border-radius:0!important}.pdfdoc .btn{border:0!important;background:none!important;padding:0!important;color:#111!important;font:inherit!important}.pdfdoc table.dense td,.pdfdoc table.dense th{white-space:normal}
`;
