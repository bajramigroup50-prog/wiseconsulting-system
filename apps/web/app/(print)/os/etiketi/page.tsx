/** Legacy `osLabelsHTML` 8656 (`Etiketa_<invNo>.pdf` / `Etiketi_osnovni_sredstva.pdf`): 62 × 30 mm labels with a QR code. */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { osCmp, osQrText } from '@wise/core/yearend/assets-io';
import { fixedAssets } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { Qr } from '@/components/qr';

export default async function OsLabels({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const { firm } = await booksPage('os');
  if (!firm) notFound();
  const A = (await db().select().from(fixedAssets).where(and(eq(fixedAssets.firmId, firm.id), id ? eq(fixedAssets.id, id) : undefined))).sort(osCmp);
  if (!A.length) notFound();
  return (
    <>
      <title>{A.length === 1 ? `Etiketa_${A[0]!.invNo ?? ''}` : 'Etiketi_osnovni_sredstva'}</title>
      <style>{'.oslab{display:inline-block;width:62mm;height:30mm;border:1px dashed #999;margin:2mm;padding:2mm;box-sizing:border-box;vertical-align:top;font:9pt Arial;overflow:hidden}.oslab .q{float:left;width:24mm;height:24mm;margin-right:2mm}.oslab b{font-size:13pt;display:block}'}</style>
      {await Promise.all(A.map(async (a) => {
        const plate = String((a.data as { plate?: string }).plate ?? '');
        return (
          <div className="oslab" key={a.id}>
            <span className="q"><Qr text={osQrText({ ...a, invNo: a.invNo })} size="24mm" /></span>
            <b>{a.invNo}</b>{a.name.slice(0, 40)}<br />
            <small>{a.serial ? 'С/Б: ' + a.serial : ''}{plate ? ' · ' + plate : ''}</small><br />
            <small>{firm.name}</small>
          </div>
        );
      }))}
    </>
  );
}
