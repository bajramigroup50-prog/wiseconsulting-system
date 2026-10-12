/**
 * 🔐 Уреди (компјутери) (Систем, owner only): the computers allowed to reach the server (mutual TLS, one client
 * certificate per computer — `lib/device-certs.ts`). List grouped by firm (office first), „+ Нов уред“ with the
 * one-file installer for that computer, „🚫 Одземи“, and the current enforcement mode with what to do next.
 */
import { notFound } from 'next/navigation';
import { Hd, dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { OFFICE_LABEL, deviceSetup, devicesGate, firmChoices, groupDevices, listDevices } from '@/lib/devices';
import { revokeDevice } from './actions';
import { NewDevice, type FirmChoice } from './new-device';

const T = '🔐 Уреди (компјутери)';
const dmy = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10).split('-').reverse().join('.') : '—');

const MODE: Record<string, [string, string]> = {
  off: ['ИСКЛУЧЕНО', 'Серверот е отворен за секој компјутер (само со корисничко име и лозинка). Креирајте уреди и инсталирајте ги, потоа префрлете на „optional“.'],
  optional: ['ПРОБНО (optional)', 'Компјутерите без сертификат уште влегуваат; одземените и непознатите се одбиваат. Кога сите компјутери ќе бидат инсталирани (колоната „Последно“ е пополнета), префрлете на „required“.'],
  required: ['ЗАДОЛЖИТЕЛНО (required)', 'Само инсталираните компјутери можат да го отворат серверот. Сите други не добиваат ни страница за најава.'],
};

export default async function UrediPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { u, ok } = await devicesGate();
  if (u.role === 'klient' || u.role === 'teren') notFound();
  if (!ok) return <><Hd t={T} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  const sp = await searchParams;
  const nov = typeof sp.nov === 'string' ? sp.nov : '';
  const [R, setup, F] = await Promise.all([listDevices(), deviceSetup(), firmChoices()]);
  const G = groupDevices(R);
  const cnt = new Map<string, { n: number; max: number }>();
  for (const r of R) { const k = r.firmId ?? 'office'; const c = cnt.get(k) ?? { n: 0, max: 0 }; c.n++; c.max = Math.max(c.max, r.no); cnt.set(k, c); }
  const choices: FirmChoice[] = F.map((f) => ({ ...f, devices: cnt.get(f.id)?.n ?? 0, maxNo: cnt.get(f.id)?.max ?? 0 }));
  const fresh = nov ? R.find((r) => r.id === nov && r.status === 'active' && r.hasBundle) : undefined;
  const [mt, md] = MODE[setup.mode]!;
  const active = R.filter((r) => r.status === 'active').length;
  return (
    <>
      <Hd t={T} sub={`${active} активни`} exp={false} />
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Режим на заштита: <span className={setup.mode === 'required' ? 'pill good' : setup.mode === 'optional' ? 'pill warn' : 'pill'}>{mt}</span></h3>
        <p>{md}</p>
        <ul className="note" style={{ margin: 0 }}>
          <li>Сертификат на канцеларијата (CA): {setup.ca.ok ? <b>✔ {setup.ca.cn}, важи до {dmy(setup.ca.notAfter)}</b> : <b className="bad">✖ не е креиран (docker/device-ca.sh на серверот)</b>}</li>
          <li>Инсталација на програмата: {setup.installer.ok ? <b>✔ WISE-Setup.exe ({Math.round((setup.installer.size ?? 0) / 1048576)} MB)</b> : <b className="bad">✖ не е поставена ({setup.installer.path})</b>}</li>
          <li>Режимот се менува на серверот: <code>DEVICE_CERTS=off|optional|required</code> во /opt/wise/.env, па deploy. Упатство: docs/INSTALIM-UREDI.md.</li>
        </ul>
      </div>
      {fresh && (
        <div className="callout good" role="status">
          ✔ Креиран е уредот <b>{fresh.name}</b>.{' '}
          <a className="btn pri" href={`/uredi/installer/${fresh.id}`}>⬇ Преземи инсталација за овој уред</a>
          <div className="note">Однесете ја датотеката на тој компјутер (USB) и кликнете двапати — програмата се инсталира и се отвора најавата. Не ја праќајте по е-пошта.</div>
        </div>
      )}
      <NewDevice firms={choices} office={OFFICE_LABEL} officeCount={cnt.get('office')?.n ?? 0} officeMax={cnt.get('office')?.max ?? 0} />
      {!G.length && <div className="card empty">Уште нема уреди.</div>}
      {G.map((g) => (
        <div className="card" key={g.key}>
          <h3 style={{ marginTop: 0 }}>{g.key === 'office' ? '🏢 ' : '🏪 '}{g.label} <span className="mk">({g.rows.length})</span></h3>
          <div className="tw"><table className="dense">
            <thead><tr><th>Уред</th><th>Креиран</th><th>Последно</th><th>IP</th><th>Важи до</th><th>Статус</th><th></th></tr></thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.id} className={r.status === 'revoked' ? 'mk' : undefined}>
                  <td title={`SHA-256: ${r.fingerprint}`}>{r.name}</td>
                  <td>{dmyHm(r.createdAt)}</td>
                  <td>{r.lastSeenAt ? dmyHm(r.lastSeenAt) : <span className="mk">уште не е поврзан</span>}</td>
                  <td>{r.lastSeenIp ?? '—'}</td>
                  <td>{dmy(r.notAfter)}</td>
                  <td>{r.status === 'active' ? <span className="pill good">активен</span>
                    : <span className="pill bad" title={r.revokeReason ?? ''}>одземен {dmy(r.revokedAt)}</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status === 'active' && r.hasBundle && <a className="btn sm" href={`/uredi/installer/${r.id}`} title="Инсталација за овој уред">⬇ Инсталација</a>}{' '}
                    {r.status === 'active' && <RowAction action={revokeDevice.bind(null, r.id, undefined)} label="🚫 Одземи" className="btn sm danger"
                      confirm={`Да се одземе пристапот за „${r.name}“? Компјутерот веднаш го губи пристапот до серверот.`} showOk />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      ))}
      <p className="note">Истиот сертификат важи и за Chrome / Edge на тој компјутер (Windows го чува во „Лични сертификати“ на корисникот) — прелистувачот еднаш прашува кој сертификат да го користи.</p>
    </>
  );
}
