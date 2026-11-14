'use client';
/**
 * One tap from the client home: „📷 Фотографирај и испрати документ“ opens the phone's back camera straight away;
 * the photos taken are handed to `/klFoto` (in memory of this tab, client-side navigation) where the client picks the
 * kind and presses „Испрати“. Nothing is uploaded here.
 */
import { useRouter } from 'next/navigation';

let handoff: File[] = [];
/** Photos taken on the home screen, once (cleared on read). */
export function takeHandoff(): File[] { const f = handoff; handoff = []; return f; }

export function QuickCam() {
  const router = useRouter();
  return (
    <label className="btn pri kl-cam" role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.click(); } }}>
      📷 Фотографирај и испрати документ
      <input type="file" accept="image/*" capture="environment" multiple hidden
        onChange={(e) => { handoff = Array.from(e.target.files ?? []); e.target.value = ''; router.push('/klFoto'); }} />
    </label>
  );
}
