/**
 * 🏦 Комерцијална банка – Барање + Договор за Host-to-Host конекција, filled for the chosen firm: the bank's own forms
 * (page images in /public/forms/kb-h2h, 150 dpi) with the firm's data on top at the same places as on the PDF
 * (positions in pt of the A4 page). Print or save as PDF; the office owner signs as the responsible person.
 */
import { notFound } from 'next/navigation';
import { feedPublicKey } from '@wise/db';
import { db } from '@/lib/db';
import { isOfficeOwner, officeOwner } from '@/lib/office-owner';
import { printGuard } from '../guard';

export const metadata = { title: 'Комерцијална – Host-to-Host' };

const IP = '207.180.254.154';
type T = { x: number; y: number; t: string; s?: number; b?: boolean; w?: number };

const css = `
.kbp{position:relative;width:595pt;height:842pt;background-size:100% 100%;background-repeat:no-repeat;margin:0 auto 14px;box-shadow:0 1px 6px rgba(0,0,0,.15);break-after:page;page-break-after:always;overflow:hidden}
.kbp:last-child{break-after:auto;page-break-after:auto}
.kbp span{position:absolute;white-space:nowrap;color:#000073;font-family:Arial,Helvetica,sans-serif;line-height:1}
.kbp .key{white-space:normal;word-break:break-all;font-family:Consolas,'Courier New',monospace;line-height:1.25}
@page{size:A4;margin:0}
@media print{.kbp{box-shadow:none;margin:0}}
`;

const Page = ({ img, T, children }: { img: string; T?: T[]; children?: React.ReactNode }) => (
  <div className="kbp" style={{ backgroundImage: `url(/forms/kb-h2h/${img}.png)` }}>
    {T?.map((x, i) => (
      <span key={i} style={{ left: `${x.x}pt`, top: `${x.y - (x.s ?? 10) * 0.8}pt`, fontSize: `${x.s ?? 10}pt`, fontWeight: x.b ? 700 : 400, ...(x.w ? { maxWidth: `${x.w}pt`, overflow: 'hidden' } : {}) }}>{x.t}</span>
    ))}
    {children}
  </div>
);

/** Font size so that a text fits a width (Arial bold ≈ 0.6 em per character for capitals). */
const fit = (t: string, w: number, s: number) => Math.max(6, Math.min(s, w / (t.length * 0.6)));

export default async function KbH2h() {
  const { u, firm } = await printGuard('bankFeed');
  if (!(await isOfficeOwner(u))) notFound();
  const S = (firm.settings ?? {}) as Record<string, unknown> & { signer?: string; signerRole?: string };
  const [key, owner] = await Promise.all([feedPublicKey(db(), 'rsa'), officeOwner()]);
  const name = String(firm.name ?? '').replace(/\s+/g, ' ').trim();
  // the Komercijalna (300…) account: the invoice account or any other account field of the firm (bankAccount, realBank, bank2…)
  const accs = ['bank', 'bankAccount', 'realBank', 'bank2', 'bank3'].map((k) => String(S[k] ?? '').replace(/\D/g, ''));
  const kb = accs.find((a) => a.startsWith('300') && a.length === 15)
    ?? (JSON.stringify(S).match(/\b300\d{12}\b/)?.[0] ?? '');
  const mgr = String(S.signer ?? '').trim();
  const role = String(S.signerRole || 'управител').toLowerCase();
  const resp = String(owner?.name ?? u.name).toUpperCase();
  const d = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' }).split('-');
  const req: T[] = [
    { x: 190, y: 193, t: name, s: fit(name, 305, 11), b: true },
    ...[...kb].map((ch, i) => ({ x: 204 + 19.2 * i + 6, y: 234, t: ch, s: 11 })),
    { x: 190, y: 338, t: resp, s: 11, b: true },
    { x: 80, y: 415, t: IP, s: 11, b: true },
    { x: 84, y: 605, t: d[2]!, s: 10 }, { x: 116, y: 605, t: d[1]!, s: 10 }, { x: 160, y: 605, t: d[0]!.slice(2), s: 10 },
  ];
  const dog1: T[] = [
    { x: 110, y: 285, t: name, s: fit(name, 168, 10), b: true },
    ...(mgr ? [{ x: 245, y: 298, t: `${mgr}, ${role}`, s: fit(`${mgr}, ${role}`, 180, 10), b: true }] : []),
  ];
  const dog7: T[] = [
    { x: 90, y: 690, t: '_____________________________', s: 10 },
    { x: 90, y: 705, t: name, s: fit(name, 230, 9), b: true },
    ...(mgr ? [{ x: 90, y: 717, t: `${mgr}, ${role}`, s: 9 }] : []),
  ];
  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="callout noprint" style={{ maxWidth: '595pt', margin: '0 auto 10px' }}>
        <b>{name}</b> – Барање и Договор за Host-to-Host (Комерцијална банка). {!kb && <b style={{ color: 'var(--bad)' }}>Фирмата нема сметка во Комерцијална (300…) во поставките – кутиите се празни. </b>}
        {!mgr && <b style={{ color: 'var(--bad)' }}>Нема управител во поставките на фирмата. </b>}
        {!key && <b style={{ color: 'var(--bad)' }}>Нема SSH-RSA клуч – направете го во „Изводи од банка → 🔑 SSH-RSA 4096 клуч“. </b>}
        Рачно: матичен број на одговорното лице, потпис и печат. Печатење: Ctrl+P (A4, без маргини).
      </div>
      <Page img="barane-1" T={req}>
        {key && <span className="key" style={{ left: '76pt', top: '500pt', width: '432pt', fontSize: '5.6pt' }}>{key}</span>}
      </Page>
      <Page img="dogovor-1" T={dog1} />
      {[2, 3, 4, 5, 6].map((i) => <Page key={i} img={`dogovor-${i}`} />)}
      <Page img="dogovor-7" T={dog7} />
    </div>
  );
}
