/** Legacy `firmHead()` 3254 + `ph()` 3255 + `sig()` 3257 for print views. */
import type { Firm } from '@wise/db';
import { dmy } from '@/lib/fmt';

export function FirmHead({ firm, title, sub }: { firm: Pick<Firm, 'name' | 'address' | 'city' | 'phone' | 'email' | 'edb' | 'embs'> & { settings?: unknown }; title: string; sub?: string }) {
  const st = (firm.settings ?? {}) as { bank?: string; bankName?: string; phone2?: string };
  return (
    <>
      <div className="fh">
        <div className="fn">{String(firm.name ?? '').toUpperCase()}</div>
        <div className="fa">
          {[firm.address, firm.city].filter(Boolean).join(' ')}{firm.phone ? ' * Тел.: ' + firm.phone + (st.phone2 ? ', ' + st.phone2 : '') : ''}{firm.email ? ' * ' + firm.email : ''}<br />
          {st.bank ? 'Жиро сметка: ' + st.bank + ' * ' : ''}{st.bankName ? 'Банка: ' + st.bankName + ' * ' : ''}ЕДБ: {firm.edb ?? ''}{firm.embs ? ' * ЕМБС: ' + firm.embs : ''}
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
