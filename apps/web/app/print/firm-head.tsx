/** Legacy `firmHead()` 3254 + `ph()` 3255 + `sig()` 3257 for print views. */
import type { Firm } from '@wise/db';
import { dmy } from '@/lib/fmt';

export function FirmHead({ firm, title, sub }: { firm: Pick<Firm, 'name' | 'address' | 'city' | 'phone' | 'email' | 'edb' | 'embs'>; title: string; sub?: string }) {
  return (
    <>
      <div className="fh">
        <div className="fn">{String(firm.name ?? '').toUpperCase()}</div>
        <div className="fa">
          {[firm.address, firm.city].filter(Boolean).join(' ')}{firm.phone ? ' * Тел.: ' + firm.phone : ''}{firm.email ? ' * ' + firm.email : ''}<br />
          ЕДБ: {firm.edb ?? ''}{firm.embs ? ' * ЕМБС: ' + firm.embs : ''}
        </div>
      </div>
      <div className="ph">
        <div><div className="pt">{title}</div>{sub && <div className="ps">{sub}</div>}</div>
        <div className="pm">Отпечатено: {dmy(new Date().toISOString())}</div>
      </div>
    </>
  );
}

export const Sig = ({ who = ['Составил', 'Одговорно лице'] }: { who?: string[] }) => (
  <div className="sig">{who.map((w) => <span key={w}>{w}</span>)}</div>
);
