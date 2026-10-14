/**
 * „📷 Испрати документ“ — the client's phone screen (works as the installed app, manifest shortcut): pick the kind,
 * photograph (several pages) or pick PDFs, optional note, send. Below: what this client sent and its status
 * (примено = in the office inbox, обработено = the office routed it). The firm is the session's; only own messages.
 */
import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { CAPTURE_KINDS, CAPTURE_STATUS, captureStatus, INBOX_ROUTES, isCaptureKind } from '@wise/core/office';
import { inboxItems, OFFICE_FILE_ENTITY } from '@wise/db';
import { db } from '@/lib/db';
import { filesOf, officePage } from '@/lib/office';
import { FileChips, Pill } from '@/components/file-chips';
import { Hd, dmyHm } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { Capture } from './capture';

const CSS = `.kfoto{max-width:560px}
.kf-step{font-weight:700;margin:14px 0 6px;font-size:15px}
.kf-kinds{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.kf-kind{display:flex;align-items:center;gap:8px;min-height:56px;padding:10px 12px;border:2px solid var(--line);border-radius:12px;background:var(--card,#fff);font-size:16px;text-align:left;cursor:pointer;color:inherit}
.kf-kind span{font-size:22px}.kf-kind.on{border-color:var(--pri,#1a7f37);background:color-mix(in srgb,var(--pri,#1a7f37) 10%,transparent);font-weight:700}
.kf-pick{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.kf-big{display:flex;align-items:center;justify-content:center;min-height:72px;border-radius:14px;border:2px solid var(--line);font-size:18px;font-weight:700;cursor:pointer;text-align:center}
.kf-big.pri{background:var(--pri,#1a7f37);border-color:var(--pri,#1a7f37);color:#fff}
.kf-thumbs{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.kf-thumb{position:relative;width:86px;height:110px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#f2f4f7}
.kf-thumb img{width:100%;height:100%;object-fit:cover}.kf-thumb b{position:absolute;left:4px;bottom:4px;background:#0009;color:#fff;border-radius:6px;padding:0 6px;font-size:12px}
.kf-thumb button{position:absolute;right:2px;top:2px;width:30px;height:30px;border-radius:50%;border:0;background:#000a;color:#fff;font-size:15px}
.kf-pdf{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-weight:700;color:#b42318}.kf-pdf small{font-weight:400;color:#475467;font-size:10px;word-break:break-all;padding:0 4px;text-align:center}
.kf-chk{display:flex;gap:8px;align-items:center;margin-top:10px;font-size:15px}.kf-chk input{width:22px;height:22px}
.kf-note{width:100%;font-size:16px;border-radius:10px;padding:10px}
.kf-send{display:block;width:100%;min-height:64px;margin-top:14px;border:0;border-radius:14px;background:var(--pri,#1a7f37);color:#fff;font-size:20px;font-weight:800;cursor:pointer}
.kf-send:disabled{opacity:.6}
.kf-msg{margin-top:10px;padding:10px 12px;border-radius:10px;background:#ecfdf3;color:#05603a;font-size:15px}.kf-msg.bad{background:#fffaeb;color:#93370d}
.kf-queue{margin-top:12px;padding:10px 12px;border:1px dashed #e08a00;border-radius:10px}
@media(max-width:420px){.kf-kind{font-size:15px;min-height:52px}}`;

export default async function KlFotoPage() {
  const { u, firm } = await officePage('klFoto', { perm: 'write' });
  if (!firm) return <NoFirm t="📷 Испрати документ" />;
  const sent = await db().select().from(inboxItems)
    .where(and(eq(inboxItems.firmId, firm.id), eq(inboxItems.fromOffice, false), eq(inboxItems.fromUserId, u.id))).orderBy(desc(inboxItems.createdAt)).limit(30);
  const F = await filesOf(OFFICE_FILE_ENTITY.inbox, sent.map((s) => s.id));
  return (
    <>
      <style>{CSS}</style>
      <Hd t="📷 Испрати документ" sub={firm.name} exp={false} />
      <div className="card"><Capture firmId={firm.id} /></div>
      <div className="card">
        <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Испратено ({sent.length})</h2><Link className="btn sm ghost" href="/klSend">📤 Порака / внес на документ</Link></div>
        {sent.length ? (
          <div className="tw"><table className="dense"><thead><tr><th>Испратено</th><th>Што</th><th>Датотеки</th><th>Статус</th></tr></thead><tbody>
            {sent.map((s) => {
              const st = captureStatus(s);
              return (
                <tr key={s.id}>
                  <td>{dmyHm(s.createdAt)}</td>
                  <td>{isCaptureKind(s.docKind) ? CAPTURE_KINDS[s.docKind].label : (s.subject ?? 'Порака')}{s.note && <div className="mini">{s.note}</div>}</td>
                  <td><FileChips files={F.get(s.id)} /></td>
                  <td><Pill c={st === 'processed' ? 'good' : 'info'}>{CAPTURE_STATUS[st]}</Pill>
                    {s.done && s.route && <div className="mini">→ {INBOX_ROUTES[s.route as keyof typeof INBOX_ROUTES] ?? s.route}</div>}</td>
                </tr>
              );
            })}
          </tbody></table></div>
        ) : <p className="note">Сè уште ништо.</p>}
      </div>
    </>
  );
}
