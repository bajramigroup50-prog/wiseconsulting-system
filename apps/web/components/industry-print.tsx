/** Header / signatures of the Phase 10 print views (legacy `ph(title, sub)` and `sig(...)`). */
import type { Firm } from '@wise/db';

export function DocHead({ firm, title, sub }: { firm: Pick<Firm, 'name' | 'address' | 'city' | 'edb'>; title: string; sub?: string }) {
  return (
    <>
      <div className="fh"><div className="fn">{firm.name}</div><div className="fa">{[firm.address, firm.city, firm.edb ? 'ЕДБ ' + firm.edb : ''].filter(Boolean).join(' · ')}</div></div>
      <div className="ph"><div><div className="pt">{title}</div>{sub && <div className="ps">{sub}</div>}</div></div>
    </>
  );
}

export function Signs({ L }: { L: string[] }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 40, gap: 20 }}>
      {L.map((x) => <span key={x}>{x}: ______________________</span>)}
    </div>
  );
}
