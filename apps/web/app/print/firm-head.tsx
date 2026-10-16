/** Legacy `firmHead()` 3254 + `ph()` 3255 + `sig()` 3257 for print views. */
import type { Firm } from '@wise/db';
import { fixYuscii } from '@wise/core/text/yuscii';
import { dmy } from '@/lib/fmt';

export function FirmHead({ firm, title, sub }: { firm: Pick<Firm, 'name' | 'address' | 'city' | 'phone' | 'email' | 'edb' | 'embs'> & { settings?: unknown }; title: string; sub?: string }) {
  // old YUSCII fonts (^ ~ [ ] …) inside Cyrillic words are shown as letters; stored data is fixed in /firmi/kirilica
  const st = (firm.settings ?? {}) as { bank?: string; bankName?: string; phone2?: string };
  return (
    <>
      <div className="fh">
        <div className="fn">{fixYuscii(firm.name).toUpperCase()}</div>
        <div className="fa">
          {fixYuscii([firm.address, firm.city].filter(Boolean).join(' '))}{firm.phone ? ' * Тел.: ' + firm.phone + (st.phone2 ? ', ' + st.phone2 : '') : ''}{firm.email ? ' * ' + firm.email : ''}<br />
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
