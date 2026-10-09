'use client';
/**
 * Legacy ACT `bomAI` (13860): ask the AI for a normativ of the product from the firm's materials (text-only read in the
 * worker); when it is done the page reopens with `?ai=<id>` and the editor shows the proposal to check and save.
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AiReadList, useAiRead } from '@/components/ai-read';

export function BomAi({ firmId, productId }: { firmId: string; productId: string }) {
  const router = useRouter();
  const ai = useAiRead(firmId);
  useEffect(() => {
    const d = ai.docs.find((x) => x.status === 'done');
    if (d) { ai.reset(); router.push(`/normativ?p=${productId}&ai=${d.id}`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.docs]);
  return (
    <>
      <button className="btn" type="button" disabled={ai.busy} onClick={() => void ai.suggest(productId)}>{ai.busy ? '⏳ AI предлага…' : '🤖 AI предлог за норматив'}</button>
      <AiReadList docs={ai.docs} msg={ai.msg} />
    </>
  );
}
