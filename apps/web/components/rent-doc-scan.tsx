'use client';
/**
 * Legacy `rcScanDoc` 11701 („📷 Скенирај пасош / лична карта“, „🪪 Скенирај возачка дозвола“ in the rent-a-car
 * contract): photos / PDF of the customer's document are stored (copies kept with the contract) and read in the worker
 * (`ai.read-document`, kind `rcdoc` / `rclic`); when the read is done the contract form reopens prefilled
 * (`?scan=<id>`) — „Проверете ги податоците.“
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AiDrop, AiReadList, useAiRead } from '@/components/ai-read';

export function RentDocScan({ firmId, variant = 'rent' }: { firmId: string; variant?: 'rent' | 'passport' }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const ai = useAiRead(firmId);
  const [kind, setKind] = useState<'rcdoc' | 'rclic' | null>(null);
  useEffect(() => {
    const d = ai.docs.find((x) => x.status === 'done');
    if (d) {
      ai.reset(); setKind(null);
      const q = new URLSearchParams(sp.toString());
      q.set('scan', d.id);
      if (variant === 'rent' && !q.get('id')) q.set('nov', '1');
      router.push(`${path}?${q.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.docs]);
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '2px 0 10px' }}>
      <button type="button" className="btn pri" style={{ fontWeight: 700 }} onClick={() => setKind(kind === 'rcdoc' ? null : 'rcdoc')}>{variant === 'passport' ? '📷 Скенирај пасош' : '📷 Скенирај пасош / лична карта'}</button>
      {variant === 'rent' && <button type="button" className="btn" style={{ fontWeight: 700 }} onClick={() => setKind(kind === 'rclic' ? null : 'rclic')}>🪪 Скенирај возачка дозвола</button>}
      <span className="mini">{variant === 'passport' ? 'Секој скениран пасош додава нов патник со податоците (име, датум на раѓање, државјанство, број и важност на пасошот).' : 'Сликајте ја страницата со фотографија (и задната страна кај лична карта) – податоците се пополнуваат автоматски.'}</span>
      {kind && (
        <div className="card" style={{ flexBasis: '100%' }}>
          <AiDrop small multiple onFiles={(f) => void ai.read(kind, f.slice(0, 4))} disabled={ai.busy}
            label={<><b>Изберете или фотографирајте {kind === 'rclic' ? 'возачка дозвола' : 'пасош / лична карта'}</b> — слика (JPG/PNG), фотографија од телефон или PDF.</>} />
          <AiReadList docs={ai.docs} msg={ai.msg} />
        </div>
      )}
    </div>
  );
}
