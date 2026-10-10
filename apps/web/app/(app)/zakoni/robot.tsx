/** Legacy `robotSVG` (v465) — the law robot figure with blinking eyes and the LED (red = new changes). */
const CSS = `.lawbot .lb-eyes{transform-origin:60px 47px;animation:lbBlink 4.5s infinite}@keyframes lbBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}.lawbot .lb-led{animation:lbLed 1.6s infinite}@keyframes lbLed{0%,100%{opacity:1}50%{opacity:.35}}
.lawbot-hero{display:flex;gap:16px;align-items:center;background:linear-gradient(135deg,var(--accent-soft),transparent);border:1px solid var(--line);border-radius:16px;padding:14px 18px;margin:8px 0 12px}.lawbot-say{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 14px;flex:1;font-size:14px}.lawbot-say:before{content:'';position:absolute;left:-8px;top:24px;width:14px;height:14px;background:var(--panel);border-left:1px solid var(--line);border-bottom:1px solid var(--line);transform:rotate(45deg)}
@media(prefers-reduced-motion:reduce){.lawbot .lb-eyes,.lawbot .lb-led{animation:none}}`;

export function RobotCss() { return <style>{CSS}</style>; }

export function Robot({ size = 48, alert = false, id = 'rb' }: { size?: number; alert?: boolean; id?: string }) {
  return (
    <svg className="lawbot" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}h`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2f8f72" /><stop offset="1" stopColor="#0f5a47" /></linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e9f3ef" /><stop offset="1" stopColor="#cfe3db" /></linearGradient>
      </defs>
      <line x1="60" y1="8" x2="60" y2="22" stroke="#0f5a47" strokeWidth="4" strokeLinecap="round" /><circle className="lb-led" cx="60" cy="8" r="6" fill={alert ? '#e5484d' : '#f5b301'} />
      <rect x="20" y="20" width="80" height="56" rx="18" fill={`url(#${id}h)`} />
      <rect x="10" y="38" width="12" height="20" rx="5" fill="#0f5a47" /><rect x="98" y="38" width="12" height="20" rx="5" fill="#0f5a47" />
      <rect x="30" y="30" width="60" height="36" rx="12" fill="#0b2e25" />
      <g className="lb-eyes"><circle cx="47" cy="47" r="7" fill="#7cf0c8" /><circle cx="73" cy="47" r="7" fill="#7cf0c8" /><circle cx="49" cy="45" r="2.2" fill="#fff" /><circle cx="75" cy="45" r="2.2" fill="#fff" /></g>
      <path d="M50 58 Q60 64 70 58" stroke="#7cf0c8" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="32" y="78" width="56" height="34" rx="10" fill={`url(#${id}b)`} stroke="#0f5a47" strokeWidth="2" />
      <g stroke="#0f5a47" strokeWidth="2.4" fill="none" strokeLinecap="round"><line x1="60" y1="84" x2="60" y2="104" /><line x1="46" y1="88" x2="74" y2="88" /><path d="M46 88 l-6 10 h12 z" fill="#f5b301" strokeLinejoin="round" /><path d="M74 88 l-6 10 h12 z" fill="#f5b301" strokeLinejoin="round" /><line x1="53" y1="105" x2="67" y2="105" /></g>
    </svg>
  );
}
