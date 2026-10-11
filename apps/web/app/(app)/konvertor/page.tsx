/**
 * Систем › „🔄 Конвертор на датотеки“ — files of other programs / banks / suppliers into the import formats of the
 * program, without AI (see `@wise/core/convert`). Office-wide: no firm needed; presets are shared by the office.
 */
import { getConvPresets } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { Converter } from './converter';

export default async function KonvertorPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const sp = await searchParams;
  await booksPage('konvertor');
  const presets = await getConvPresets(db());
  return (
    <>
      <Hd t="🔄 Конвертор на датотеки" sub="Excel / CSV / XML / PDF со текст → образец за увоз, без AI" />
      <Converter initialPresets={presets} initialTarget={sp.t} />
    </>
  );
}
