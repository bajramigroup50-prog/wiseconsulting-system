/**
 * Систем › „🌐 Превод (DeepL)“ (new): translate a pasted text or a document (PDF / Word / Excel / PowerPoint) into
 * MK / SQ / EN / DE with DeepL (`lib/deepl.ts`, server key `DEEPL_API_KEY`), and the characters used per month.
 * The same translation is a button on the documents of a firm (🗂 Досие, 📥 Пристигнати документи) and on the invoice
 * print („🌐 Фактура на англиски / германски“).
 */
import { booksPage } from '@/lib/books';
import { deeplConfigured, deeplMonths, deeplUsage, DEEPL_FREE_LIMIT, DEEPL_NO_KEY } from '@/lib/deepl';
import { Hd } from '@/components/hd';
import { DocTranslate, TextTranslate } from './client';

const n = (v: number) => v.toLocaleString('mk-MK');

export default async function PrevodPage() {
  const { firm } = await booksPage('prevod');
  const on = deeplConfigured();
  const [months, live] = await Promise.all([deeplMonths(), deeplUsage()]);
  const limit = live?.limit ?? DEEPL_FREE_LIMIT;
  const used = live?.count ?? months[0]?.chars ?? 0;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <>
      <Hd t="🌐 Превод (DeepL)" sub="Текст или документ → македонски, албански, англиски, германски" />
      {!on && <div className="callout warn"><b>{DEEPL_NO_KEY}</b><br />Сопственикот прави бесплатен клуч на deepl.com (DeepL API Free, 500.000 знаци месечно) и го додава во <code>.env</code> на серверот како <code>DEEPL_API_KEY=…</code>.</div>}
      {on && (
        <div className="card">
          <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>Потрошено овој месец:</b> {n(used)} / {n(limit)} знаци ({pct}%)
            <div style={{ flex: '1 1 200px', height: 8, background: 'var(--line, #e5e7eb)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: pct >= 90 ? 'var(--bad, #c0392b)' : pct >= 70 ? 'var(--warn, #e67e22)' : 'var(--good, #2e7d32)' }} />
            </div>
            {!live && <span className="mini">(бројач на WISE – DeepL сега не одговара)</span>}
          </div>
          {months.length > 0 && <p className="mini" style={{ marginTop: 6 }}>Според WISE: {months.slice(0, 6).map((m) => `${m.month.split('-').reverse().join('.')}: ${n(m.chars)}`).join(' · ')}</p>}
          <p className="note">Секој документ DeepL го наплаќа најмалку 50.000 знаци – за краток текст користете „Текст“.</p>
        </div>
      )}
      <TextTranslate disabled={!on} />
      <DocTranslate firmId={firm?.id ?? null} disabled={!on} />
    </>
  );
}
