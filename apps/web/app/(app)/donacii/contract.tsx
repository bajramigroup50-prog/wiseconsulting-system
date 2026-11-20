/**
 * Donation / sponsorship contract and the confirmation of the realised donation („Потврда за примена донација“) —
 * Закон за донации и спонзорства во јавните дејности; the donor needs both for the recognised expense (ЗДД чл. 9).
 * One template for both roles: the firm is the recipient (`received`) or the donor / sponsor (`given`).
 */
import type { Donation, Firm, Partner } from '@wise/db';
import { DON_LIMIT, DON_PARTY, type DonKind } from '@wise/core/donations';
import { amountInWords } from '@wise/core/sales/words';
import { dmy, fmt } from '@/lib/fmt';

type Party = { name: string; addr: string; id: string; rep: string; acct: string; legal: boolean };
export type DonDoc = Pick<Donation, 'kind' | 'role' | 'partnerName' | 'number' | 'date' | 'place' | 'amount' | 'inKind' | 'inKindDesc' | 'purpose' | 'area' | 'counter' | 'termDate' | 'cash' | 'confNumber' | 'confDate' | 'confAmount' | 'confNote'>;
export type DonMoveRow = { date: string; amt: number; src: string };

const LAW = 'Законот за донации и спонзорства во јавните дејности';

function parties(d: Pick<Donation, 'role' | 'partnerName'>, firm: Firm, p: Partner | undefined, firmAcct?: string) {
  const s = (firm.settings ?? {}) as { signer?: string; signerRole?: string; bank?: string; bankName?: string };
  const F: Party = {
    name: firm.name, addr: [firm.address, firm.city].filter(Boolean).join(', '), id: 'ЕДБ ' + (firm.edb ?? '') + (firm.embs ? ', ЕМБС ' + firm.embs : ''),
    rep: (s.signer || '________________') + (s.signerRole ? ` (${s.signerRole})` : ' (одговорно лице)'), acct: [s.bank || firmAcct, s.bankName].filter(Boolean).join(' кај '), legal: true,
  };
  const pd = (p?.data ?? {}) as { embg?: string; fl?: boolean; person?: boolean; manager?: string };
  const legal = !pd.fl && !pd.person && !pd.embg && /(ДОО|ДООЕЛ|\bАД\b|\bТП\b|DOO|ЈП|ЗДРУЖЕНИЕ|ФОНДАЦИЈА|КЛУБ|СОЈУЗ|ФК|КК|РК|ОК)/i.test(p?.name ?? '');
  const P: Party = {
    name: p?.name || d.partnerName || '________________', addr: [p?.address, p?.city].filter(Boolean).join(', ') || '________________',
    id: legal ? 'ЕДБ ' + (p?.edb || '________') + (p?.embs ? ', ЕМБС ' + p.embs : '') : 'ЕМБГ ' + (pd.embg || p?.edb || '________________'),
    rep: legal ? (pd.manager ? pd.manager + ' (одговорно лице)' : 'одговорно лице ________________') : '', acct: [p?.bankAccount, p?.bankName].filter(Boolean).join(' кај '), legal,
  };
  // giver first (Донатор / Спонзор), then the recipient
  return d.role === 'received' ? { G: P, T: F } : { G: F, T: P };
}

const C = ({ n, t }: { n: number; t: string }) => <><p style={{ textAlign: 'center', margin: '10px 0 0', fontWeight: 700 }}>Член {n}</p><p style={{ textAlign: 'center', margin: 0 }}>{t}</p></>;
const pp = (x: Party, role: string) => `${x.name}, ${x.addr}, ${x.id}${x.rep ? ', застапуван од ' + x.rep : ''} (во понатамошниот текст: ${role})`;
const what = (d: DonDoc, amt: number) => d.inKind
  ? `во добра / услуги: ${d.inKindDesc || '________________'}, во вкупна вредност од ${fmt(amt)} денари (со букви: ${amountInWords(amt)})`
  : `во парични средства во износ од ${fmt(amt)} денари (со букви: ${amountInWords(amt)})`;

function Sigs({ a, b }: { a: [string, string]; b: [string, string] }) {
  return (
    <div className="sigrow" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '14mm', breakInside: 'avoid' }}>
      {[a, b].map(([r, n]) => (
        <div key={r} style={{ textAlign: 'center', minWidth: '70mm' }}><b>{r}</b><div>{n}</div><div style={{ height: '18mm' }} /><div style={{ borderTop: '1px solid #000' }}>потпис и печат</div></div>
      ))}
    </div>
  );
}

export function DonationContract({ d, firm, partner, firmAcct }: { d: DonDoc; firm: Firm; partner?: Partner; firmAcct?: string }) {
  const { G, T } = parties(d, firm, partner, firmAcct);
  const k: DonKind = d.kind;
  const R = DON_PARTY[k], sp = k === 'sponsorship';
  const amt = Number(d.amount) || 0;
  const gw = sp ? 'Спонзорот' : 'Донаторот', tw = 'Примателот';
  const noun = sp ? 'спонзорството' : 'донацијата';
  const place = d.place || firm.city || '________';
  let n = 0;
  return (
    <div style={{ fontSize: '11pt', lineHeight: 1.5 }}>
      <h2 style={{ textAlign: 'center', marginBottom: 0 }}>{sp ? 'ДОГОВОР ЗА СПОНЗОРСТВО' : 'ДОГОВОР ЗА ДОНАЦИЈА'}</h2>
      <p style={{ textAlign: 'center', marginTop: 2 }}>бр. {d.number || '____'} од {dmy(d.date)}</p>
      <p>Склучен на ден {dmy(d.date)} во {place}, врз основа на {LAW}, помеѓу:</p>
      <p>1. {pp(G, R.giver)}</p>
      <p>2. {pp(T, R.taker)}</p>
      <C n={++n} t="Предмет на договорот" />
      <p>{sp
        ? `${gw} му дава на ${tw} спонзорство ${what(d, amt)}, а ${tw} се обврзува за возврат да изврши услуга со која јавно се промовира ${gw} според член ${n + 2} од овој договор.`
        : `${gw} доброволно и без надомест му дава на ${tw} донација ${what(d, amt)}.`}</p>
      <C n={++n} t="Намена" />
      <p>{sp ? 'Спонзорството' : 'Донацијата'} е наменет{sp ? 'о' : 'а'} за {d.purpose || '________________'}{d.area ? `, во областа ${d.area}` : ''} – дејност од јавен интерес согласно {LAW}. {tw} се обврзува средствата да ги користи исклучиво за оваа намена.</p>
      {sp && <>
        <C n={++n} t="Обврски на Примателот (противуслуга)" />
        <p>{tw} се обврзува {d.counter || 'името и знакот (логото) на Спонзорот да ги истакнува на опремата, рекламните материјали и при настаните, како и да го спомнува Спонзорот во медиумите и на социјалните мрежи'}, за времетраењето на договорот.</p>
      </>}
      <C n={++n} t={d.inKind ? 'Предавање' : 'Исплата'} />
      <p>{d.inKind
        ? `${gw} ги предава добрата / ги извршува услугите од член 1 ${d.termDate ? 'најдоцна до ' + dmy(d.termDate) : 'по склучувањето на договорот'}, со записник за примопредавање потпишан од двете страни.`
        : `${gw} износот од член 1 го уплаќа ${d.cash ? 'во готово, со потврда за примени пари' : `на трансакциската сметка на ${tw}${T.acct ? ' бр. ' + T.acct : ' бр. ________________'}`} ${d.termDate ? 'најдоцна до ' + dmy(d.termDate) : 'по склучувањето на договорот'}.`}</p>
      <C n={++n} t="Потврда и известување" />
      <p>{tw} се обврзува по примањето да издаде потврда за {sp ? 'примено спонзорство' : 'примена донација'}, да води евиденција за користењето на {noun} и на барање на {gw} да го извести за начинот на кој се искористени средствата. Ако средствата не се искористат за намената од член 2, {tw} е должен да ги врати.</p>
      {!sp && <>
        <C n={++n} t="Без противуслуга" />
        <p>За донацијата {tw} не дава никаква противуслуга (паричен или непаричен надомест) на {gw}. {tw} може јавно да го наведе {gw} како донатор.</p>
      </>}
      <C n={++n} t="Даночен третман" />
      <p>{gw} го признава износот на {noun} како расход до {Math.round(DON_LIMIT[k] * 100)}% од вкупниот приход во даночниот период (Закон за данокот на добивка, член 9), врз основа на овој договор и потврдата од член {n - (sp ? 1 : 2)}.</p>
      <C n={++n} t="Завршни одредби" />
      <p>За сè што не е уредено со овој договор се применуваат {LAW} и Законот за облигационите односи. Евентуалните спорови договорните страни ќе ги решаваат спогодбено, а доколку тоа не е можно – надлежен е судот според седиштето на {tw}.</p>
      <p>Договорот е составен во 4 (четири) еднакви примероци, од кои секоја страна задржува по 2 (два).</p>
      <Sigs a={[R.giver.toUpperCase(), G.name]} b={[R.taker.toUpperCase(), T.name]} />
    </div>
  );
}

/** „Потврда за примена донација / спонзорство“ — issued by the recipient to the donor (for the donor's tax deduction). */
export function DonationConfirmation({ d, firm, partner, firmAcct, moves = [] }: { d: DonDoc; firm: Firm; partner?: Partner; firmAcct?: string; moves?: DonMoveRow[] }) {
  const { G, T } = parties(d, firm, partner, firmAcct);
  const sp = d.kind === 'sponsorship';
  const R = DON_PARTY[d.kind];
  const amt = Number(d.confAmount ?? d.amount) || 0;
  const cd = d.confDate || d.date;
  return (
    <div style={{ fontSize: '11pt', lineHeight: 1.5 }}>
      <div style={{ borderBottom: '1px solid #000', paddingBottom: 4, marginBottom: 10 }}>
        <b>{T.name}</b><br />{T.addr} · {T.id}{T.acct ? <> · Трансакциска сметка: {T.acct}</> : null}
      </div>
      <h2 style={{ textAlign: 'center', marginBottom: 0 }}>{sp ? 'ПОТВРДА ЗА ПРИМЕНО СПОНЗОРСТВО' : 'ПОТВРДА ЗА ПРИМЕНА ДОНАЦИЈА'}</h2>
      <p style={{ textAlign: 'center', marginTop: 2 }}>бр. {d.confNumber || '____'} од {dmy(cd)}</p>
      <p>Врз основа на {LAW} и {sp ? 'Договорот за спонзорство' : 'Договорот за донација'} бр. {d.number || '____'} од {dmy(d.date)}, {T.name} ({R.taker.toLowerCase()}) потврдува дека прими од:</p>
      <p style={{ marginLeft: 20 }}><b>{G.name}</b>, {G.addr}, {G.id} ({R.giver.toLowerCase()})</p>
      <p>{sp ? 'спонзорство' : 'донација'} {what(d, amt)}.</p>
      {moves.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', margin: '6px 0' }}>
          <thead><tr>{['Датум', 'Основ (извод / записник)', 'Износ (ден.)'].map((h) => <th key={h} style={{ border: '1px solid #000', padding: '2px 6px', textAlign: h.startsWith('Износ') ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {moves.map((m, i) => <tr key={i}><td style={{ border: '1px solid #000', padding: '2px 6px' }}>{dmy(m.date)}</td><td style={{ border: '1px solid #000', padding: '2px 6px' }}>{m.src}</td><td style={{ border: '1px solid #000', padding: '2px 6px', textAlign: 'right' }}>{fmt(m.amt)}</td></tr>)}
            <tr><td colSpan={2} style={{ border: '1px solid #000', padding: '2px 6px' }}><b>Вкупно</b></td><td style={{ border: '1px solid #000', padding: '2px 6px', textAlign: 'right' }}><b>{fmt(moves.reduce((s, m) => s + m.amt, 0))}</b></td></tr>
          </tbody>
        </table>
      )}
      <p>{sp ? 'Спонзорството' : 'Донацијата'} е {d.inKind ? 'примен' + (sp ? 'о' : 'а') + ' со записник за примопредавање' : d.cash ? 'примен' + (sp ? 'о' : 'а') + ' во готово' : 'уплатен' + (sp ? 'о' : 'а') + ' на нашата трансакциска сметка'} и ќе се користи исклучиво за {d.purpose || '________________'}{d.area ? ` (област: ${d.area})` : ''} – дејност од јавен интерес согласно {LAW}.</p>
      <p>{sp
        ? `За спонзорството ${R.taker.toLowerCase()} врши промоција на спонзорот согласно договорот${d.counter ? ' (' + d.counter + ')' : ''}.`
        : 'Изјавуваме дека за донацијата на донаторот не му е дадена никаква противуслуга (паричен или непаричен надомест).'}</p>
      {d.confNote && <p>{d.confNote}</p>}
      <p>Потврдата се издава на {R.giver.toLowerCase()}от за потребите на даночното признавање на расходот (Закон за данокот на добивка, член 9) и не може да се користи за други цели.</p>
      <p style={{ marginTop: '8mm' }}>Место и датум: {d.place || firm.city || '________'}, {dmy(cd)}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10mm', breakInside: 'avoid' }}>
        <div style={{ textAlign: 'center', minWidth: '70mm' }}><b>{R.taker.toUpperCase()}</b><div>{T.name}</div><div style={{ height: '18mm' }} /><div style={{ borderTop: '1px solid #000' }}>одговорно лице, потпис и печат (М.П.)</div></div>
      </div>
    </div>
  );
}
