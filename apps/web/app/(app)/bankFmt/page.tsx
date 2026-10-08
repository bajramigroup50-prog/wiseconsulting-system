/** Legacy `VIEWS.bankFmt` 12742 — Финансово › Банки и формати на изводи: which format to download from each bank. */
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { BANKS_MK, bankCodeOf } from '@wise/core';
import { appSettings, loadBankAccounts } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { Analyzer } from './analyzer';

/** Legacy `BANKS_MK` texts (12709): recommended format, what to download, weak formats, test status. */
const TIPS: Record<string, { best: string; st: string; tip: string; bad?: string }> = {
  '270': { best: 'XML (RacunPrivredaIzvod)', st: 'тестирано', tip: 'Е-банкарство → Изводи → преземи XML. Има: налогодавач/корисник, шифра и цел на дознака, денарска противвредност по курсот на банката, салда. MT940 и XLS немаат назив на комитентот.', bad: 'MT940 (нема :86:), XLS (празен опис)' },
  '300': { best: 'XML или KBFileFormat „ставки“ (.300)', st: 'тестирано (посебна сметка)', tip: 'Преземете ги двете датотеки KBFileFormat: Izvod_stavki… (ставки) и Izvod_vodecki_slog… (салда) – изберете ги заедно. Ако нуди XML за трансакциската сметка – користете XML.', bad: 'посебните сметки (пр. „Добиени средства за други намени“) немаат назив во ниеден формат' },
  '380': { best: 'чека пример', st: 'нема пример', tip: 'Пробајте ги сите формати што ги нуди е-банкарството (XML, MT940, Excel, PDF) и проверете ги тука со „Провери датотека“.' },
  '200': { best: 'чека пример', st: 'нема пример', tip: 'i-bank → изводи → извоз. Проверете ги XML / MT940 / Excel тука пред увоз.' },
  '210': { best: 'чека пример', st: 'нема пример', tip: 'НЛБ Проклик → преземање изводи. Проверете ги форматите тука пред увоз.' },
  srb: { best: 'чека пример', st: 'нема пример', tip: 'Шифрата на банката ќе се препознае од првата датотека. Проверете ги форматите тука пред увоз.' },
};

export default async function BankFmtPage() {
  const { u, firm } = await booksPage('bankFmt');
  const [A, bf] = await Promise.all([
    firm ? loadBankAccounts(db(), firm.id) : Promise.resolve([]),
    db().select().from(appSettings).where(eq(appSettings.key, 'bankfmt')).limit(1),
  ]);
  const mine = new Set(A.map((b) => bankCodeOf(b.account || b.iban)).filter(Boolean));
  const BF = (bf[0]?.value ?? {}) as Record<string, Record<string, { s: number; at: string }>>;
  const lvl = (s: number) => (s >= 4 ? 'целосен' : s >= 2.5 ? 'делумен' : 'слаб');
  return (
    <>
      <Hd t="Банки и формати на изводи" sub="кој формат да се презема од секоја банка">
        <Link className="btn" href="/banka">Изводи</Link><Link className="btn" href="/devizni">Девизни изводи</Link>
      </Hd>
      {firm && canDo(u, 'write', firm.id) && <Analyzer />}
      <div className="card"><h2>Банки</h2>
        <div className="tw"><table>
          <thead><tr><th>Банка</th><th>Шифра</th><th>Препорачан формат</th><th>Што да се преземе</th><th>Проверено со ваши датотеки</th></tr></thead>
          <tbody>{Object.entries(BANKS_MK).map(([c, b]) => {
            const t = TIPS[c]!;
            const seen = Object.entries(BF[c] ?? {}).sort((x, y) => y[1].s - x[1].s);
            return (
              <tr key={c} style={mine.has(c) ? { background: 'var(--soft)' } : undefined}>
                <td><b>{b.n}</b>{mine.has(c) && <span className="pill info"> ваша сметка</span>}</td><td>{c === 'srb' ? '—' : c}</td>
                <td>{seen[0]?.[0] ?? t.best}</td>
                <td style={{ maxWidth: 420 }}><small>{t.tip}{t.bad && <><br /><span style={{ color: 'var(--bad)' }}>Слаби: {t.bad}</span></>}</small></td>
                <td><small>{seen.length ? seen.map(([f, v]) => <div key={f}>{f} – {lvl(v.s)}</div>) : t.st}</small></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <p className="note">Правило: се книжи само изводот во кој се менува салдото на сметката (известувањата за девизен прилив не се книжат). Ако истиот извод се внесе повторно, дупликатите се прескокнуваат. Континуитетот на салдата се проверува автоматски („Недостасува извод“).</p>
      </div>
    </>
  );
}
