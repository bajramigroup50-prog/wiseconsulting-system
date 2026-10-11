/**
 * Legacy `potHTML` 13745: balance confirmation (чл. 483 ст. 3 ЗТД, чл. 7 ст. 2 Правилник за попис) — one partner. Shared by
 * the print view (`/print/fin/potvrda`, one or `all=1` partners) and the bulk e-mail of „📨 Потврди на салдо – сите“.
 */
import type { Firm, Partner } from '@wise/db';
import { dmy, fmt } from '@/lib/fmt';

export function PotvrdaDoc({ firm, p, R, to, diff, today }: {
  firm: Firm; p: Pick<Partner, 'name' | 'address' | 'city' | 'edb'>; R: { s: string; n: string; v: number }[]; to: string; diff?: number; today: string;
}) {
  const dl = new Date(Date.parse(today) + 8 * 864e5).toISOString().slice(0, 10);
  const bx: React.CSSProperties = { border: '1px solid #000', padding: '2px 6px' };
  const two = (lbl: string, L: (string | null | undefined)[]) => (
    <tr><td style={{ width: '22mm', fontWeight: 700, verticalAlign: 'top', paddingTop: 3, border: 0 }}>{lbl}</td>
      <td style={{ border: 0 }}><table style={{ borderCollapse: 'collapse', width: '120mm', margin: 0 }}><tbody>{L.map((x, i) => <tr key={i}><td style={{ ...bx, height: '5.5mm' }}>{x ?? ''}</td></tr>)}</tbody></table></td></tr>
  );
  const s = (firm.settings ?? {}) as { signer?: string; signerRole?: string };
  return (
    <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '9.5pt', lineHeight: 1.4, color: '#000' }}>
      <table style={{ borderCollapse: 'collapse', marginBottom: '5mm', border: 0 }}><tbody>
        {two('Од:', [firm.name, [firm.address, firm.city].filter(Boolean).join(', '), 'ЕДБ: ' + (firm.edb ?? '') + (firm.email ? ' · ' + firm.email : '')])}
        <tr><td style={{ height: '5mm', border: 0 }} /></tr>
        {two('До:', [p.name, [p.address, p.city].filter(Boolean).join(', '), p.edb ? 'ЕДБ: ' + p.edb : ''])}
        <tr><td style={{ height: '5mm', border: 0 }} /></tr>
        <tr><td style={{ fontWeight: 700, border: 0 }}>Дата:</td><td style={{ border: 0 }}><span style={{ ...bx, display: 'inline-block', minWidth: '40mm' }}>{dmy(today)}</span></td></tr>
      </tbody></table>
      <p style={{ fontWeight: 700, textAlign: 'justify' }}>Согласно член 483, став 3 од Законот за трговските друштва и член 7, став 2 од Правилникот за начинот за вршење на попис на средствата и обврските и усогласување на сметководствената со фактичката состојба утврдена со пописот Ви го праќаме следниот извод од нашата сметководствена евиденција, според кој состојбата на сметките побарувања од Вас/обврски кон Вас е како што е прикажано подолу. Доколку состојбата е идентична како таа евидентирана кај Вас, Ве молиме за потврда на истото (потпишана скенирана потврда пратена на e-mail).</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6mm 0 2mm', fontWeight: 700 }}>
        <span>ПОТВРДА ЗА СОСТОЈБА НА САЛДА НА СМЕТКИ ЕВИДЕНТИРАНИ ВО НАША СМЕТКОВОДСТВЕНА ЕВИДЕНЦИЈА НА ДЕН:</span>
        <span style={{ ...bx, minWidth: '32mm', textAlign: 'center', fontWeight: 400 }}>{dmy(to)}</span>
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr><th style={{ ...bx, width: '12mm' }} /><th style={{ ...bx, width: '14mm' }} /><th style={bx} /><th style={{ ...bx, width: '32mm', textAlign: 'left', fontWeight: 400 }}>Износ</th><th style={{ ...bx, width: '62mm', textAlign: 'left', fontWeight: 400 }}>Забелешка</th></tr></thead>
        <tbody>{R.map((r) => (
          <tr key={r.s}><td style={bx}>С-ка</td><td style={{ ...bx, textAlign: 'right' }}>{r.s}</td><td style={bx}>{r.n}</td>
            <td style={{ ...bx, textAlign: 'right' }}>{Math.abs(r.v) > 0.004 ? fmt(Math.abs(r.v)) + ' ден' + (r.v < 0 ? ' (обратно салдо)' : '') : ''}</td><td style={bx}>{Math.abs(r.v) > 0.004 ? p.name : ''}</td></tr>
        ))}</tbody>
      </table>
      <div style={{ display: 'flex', gap: '8mm', marginTop: '6mm' }}>
        <p style={{ flex: 1, margin: 0, textAlign: 'justify' }}>Доколку нашата евиденција соодветствува со Вашата Ве молиме потврдете со потпис од одговорното лице. Ве молиме потврдата да ја пратите потпишана од Ваша страна на нашата e-mail адреса <b>{firm.email || '______'}</b> најдоцна до <b>{dmy(dl)}</b>. Доколку не одговорите на потврдата во предвидениот рок ќе сметаме дека со истата во целост се согласувате со наведеното во истата.</p>
        <div style={{ width: '62mm' }}><div>Одговорил</div><div style={{ ...bx, height: '16mm' }} /></div>
      </div>
      <p style={{ marginTop: '6mm' }}>Доколку нашата евиденција не соодветствува со Вашата Ве молиме кусо наведете ги разликите и пратете ни картички за спроредување на истата e-mail адреса во истиот рок.</p>
      <div style={{ ...bx, height: '14mm' }} />
      {Math.abs(Number(diff) || 0) > 0.004 && <p style={{ marginTop: '4mm', fontSize: '8.5pt' }}>Напомена: при споредбата со Вашата картица е утврдена разлика од {fmt(Math.abs(Number(diff)))} ден. – записникот за усогласување е во прилог.</p>}
      <div className="sigrow" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10mm', gap: '10mm', breakInside: 'avoid' }}>
        <div style={{ textAlign: 'center', minWidth: '70mm' }}><b>{firm.name}</b><div style={{ height: '24mm' }} /><div style={{ borderTop: '1px solid #000' }}>{s.signerRole || 'Управител'}{s.signer ? ': ' + s.signer : ''}</div></div>
        <div style={{ textAlign: 'center', minWidth: '70mm' }}><b>{p.name}</b><div style={{ height: '24mm' }} /><div style={{ borderTop: '1px solid #000' }}>Одговорно лице · М.П.</div></div>
      </div>
    </div>
  );
}
