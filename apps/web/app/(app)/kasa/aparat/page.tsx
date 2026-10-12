/**
 * ⚙️ Фискален апарат — configuration of the fiscal device of THIS computer (saved by the WISE desktop app in its own
 * settings, not on the server): vendor, model, connection (COM port / IP:port / vendor program folder), operator,
 * „Статус“ and „Тест печатење“. In a browser the page explains that the device works only in the desktop app.
 */
import Link from 'next/link';
import { booksPage } from '@/lib/books';
import { Hd } from '@/components/hd';
import { FiscalConfigForm } from './fiscal-config';

export default async function FiscalDevicePage() {
  await booksPage('kasa');
  return (
    <>
      <Hd t="Фискален апарат" sub="поставки на овој компјутер">
        <Link className="btn" href="/kasa">← Фискална каса</Link>
      </Hd>
      <FiscalConfigForm />
    </>
  );
}
