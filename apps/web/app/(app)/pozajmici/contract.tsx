/** Legacy `lnParty` 16705 + `lnDoc` 16708: the loan contract (same template for given and received loans — the parties swap). */
import type { Firm, Loan, Partner } from '@wise/db';
import { dmy, fmt } from '@/lib/fmt';
import { amountInWords } from '@wise/core/sales/words';

type Party = { name: string; addr: string; id: string; rep: string };

function parties(l: Pick<Loan, 'dir' | 'partnerName'>, firm: Firm, p: Partner | undefined) {
  const s = (firm.settings ?? {}) as { signer?: string; signerRole?: string };
  const F: Party = { name: firm.name, addr: [firm.address, firm.city].filter(Boolean).join(', '), id: 'ЕДБ ' + (firm.edb ?? '') + (firm.embs ? ', ЕМБС ' + firm.embs : ''), rep: (s.signer ?? '') + (s.signerRole ? ` (${s.signerRole})` : ' (управител)') };
  const d = (p?.data ?? {}) as { embg?: string; fl?: boolean; person?: boolean };
  const legal = !d.fl && !d.person && !d.embg && /(ДОО|ДООЕЛ|\bАД\b|\bТП\b|DOO|ЈП)/i.test(p?.name ?? '');
  const P: Party = {
    name: p?.name || l.partnerName || '________________', addr: [p?.address, p?.city].filter(Boolean).join(', ') || '________________',
    id: legal ? 'ЕДБ ' + (p?.edb || '________') : 'ЕМБГ ' + (d.embg || p?.edb || '________________'), rep: legal ? 'управител ________________' : '',
  };
  return l.dir === 'given' ? { A: F, B: P } : { A: P, B: F };
}

export function LoanContract({ l, firm, partner }: { l: Pick<Loan, 'dir' | 'partnerName' | 'number' | 'date' | 'amount' | 'purpose' | 'cash' | 'rate' | 'installments' | 'termDate'>; firm: Firm; partner?: Partner }) {
  const { A, B } = parties(l, firm, partner);
  const amt = Number(l.amount) || 0;
  const pp = (x: Party, role: string) => `${x.name}, ${x.addr}, ${x.id}${x.rep ? ', застапуван од ' + x.rep : ''} (во понатамошниот текст: ${role})`;
  const rate = Number(l.rate) || 0;
  const C = ({ n, t }: { n: number; t: string }) => <><p style={{ textAlign: 'center', margin: '10px 0 0', fontWeight: 700 }}>Член {n}</p><p style={{ textAlign: 'center', margin: 0 }}>{t}</p></>;
  return (
    <div style={{ fontSize: '11pt', lineHeight: 1.5 }}>
      <h2 style={{ textAlign: 'center', marginBottom: 0 }}>ДОГОВОР ЗА ПОЗАЈМИЦА (ЗАЕМ)</h2>
      <p style={{ textAlign: 'center', marginTop: 2 }}>бр. {l.number || '____'} од {dmy(l.date)}</p>
      <p>Склучен на ден {dmy(l.date)} помеѓу:</p>
      <p>1. {pp(A, 'Заемодавач')}</p>
      <p>2. {pp(B, 'Заемопримач')}</p>
      <C n={1} t="Предмет" />
      <p>Заемодавачот му дава на Заемопримачот паричен заем (позајмица) во износ од {fmt(amt)} денари (со букви: {amountInWords(amt)}){l.purpose ? ', наменет за ' + l.purpose : ''}.</p>
      <C n={2} t="Исплата" />
      <p>Износот од член 1 се исплатува {l.cash ? 'во готово, со потврда за примени пари' : 'преку трансакциска сметка'} на ден {dmy(l.date)}.</p>
      <C n={3} t="Камата" />
      <p>{rate ? `На заемот се пресметува договорна камата од ${rate.toLocaleString('mk-MK')}% годишно, пропорционално на бројот на денови од исплатата до враќањето, која се плаќа заедно со главнината.` : 'Заемот е бескаматен – Заемопримачот не плаќа камата.'}</p>
      <C n={4} t="Враќање" />
      <p>Заемопримачот се обврзува заемот да го врати {l.installments > 1 ? `во ${l.installments} еднакви месечни рати, ` : 'еднократно, '}најдоцна до {l.termDate ? dmy(l.termDate) : '________'}, {l.cash ? 'во готово' : 'на трансакциската сметка на Заемодавачот'}. Заемопримачот може заемот да го врати и пред рокот.</p>
      <C n={5} t="Доцнење" />
      <p>Ако Заемопримачот не го врати заемот во рокот, должи и законска казнена камата од денот на доцнењето до денот на плаќањето.</p>
      <C n={6} t="Завршни одредби" />
      <p>За сè што не е уредено со овој договор се применуваат одредбите од Законот за облигационите односи. Евентуалните спорови договорните страни ќе ги решаваат спогодбено, а доколку тоа не е можно – надлежен е судот според седиштето на {l.dir === 'given' ? 'Заемодавачот' : 'Заемопримачот'}.</p>
      <p>Договорот е составен во 4 (четири) еднакви примероци, од кои секоја страна задржува по 2 (два).</p>
      <div className="sigrow" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '14mm', breakInside: 'avoid' }}>
        {[['ЗАЕМОДАВАЧ', A.name], ['ЗАЕМОПРИМАЧ', B.name]].map(([r, n]) => (
          <div key={r} style={{ textAlign: 'center', minWidth: '70mm' }}><b>{r}</b><div>{n}</div><div style={{ height: '18mm' }} /><div style={{ borderTop: '1px solid #000' }}>потпис и печат</div></div>
        ))}
      </div>
    </div>
  );
}
