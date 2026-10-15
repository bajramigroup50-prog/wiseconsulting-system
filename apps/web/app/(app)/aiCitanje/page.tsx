/**
 * Систем › „🤖 AI читање“ — the AI reading card on its own page (also inside „Податоци и резервна копија“): status,
 * last failure, on / off and „🔎 Провери го AI-кредитот сега“. Office-wide, no firm needed; the buttons are for the
 * administrator.
 */
import { booksPage } from '@/lib/books';
import { Hd } from '@/components/hd';
import { AiCard } from './ai-card';
import { canSee } from '@/lib/can-see';

export default async function AiCitanjePage() {
  const { u } = await booksPage('aiCitanje');
  // 🔒 the AI switch is an office setting (Систем): not for a book-only colleague
  const admin = u.role === 'admin' && await canSee('sistem');
  return (
    <>
      <Hd t="🤖 AI читање" sub="читање на скенирани документи со AI (Anthropic)" />
      <AiCard admin={admin} />
      {!admin && <div className="callout">Вклучување / исклучување и проверка на AI-кредитот може да прави само администраторот.</div>}
    </>
  );
}
