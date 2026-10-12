/**
 * „AI читање“ card (server component), shown in Систем › 🤖 AI читање and in „Податоци и резервна копија“: switch
 * on / off, the remembered credit / key failure, the last check and „🔎 Провери го AI-кредитот сега“ (administrator).
 * Off or blocked: the drop zones keep working, files are read without AI.
 */
import Link from 'next/link';
import { AI_ERR_MSG } from '@wise/core/ai/errors';
import { getAiSettings } from '@wise/db';
import { db } from '@/lib/db';
import { dmyHm } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { setAiEnabledAction } from '../sistem/actions';
import { aiPingAction } from './actions';

export async function AiCard({ admin }: { admin: boolean }) {
  const ai = await getAiSettings(db());
  const aiKey = !!process.env.ANTHROPIC_API_KEY;
  const ping = ai.lastPing;
  return (
    <div className="card" style={{ borderLeft: `4px solid ${ai.enabled && aiKey && !ai.lastFail ? '#1f8a4c' : '#e08a00'}` }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>AI читање: {ai.enabled ? 'вклучено' : 'исклучено'}</b>
        {!aiKey && <span className="pill bad">нема ANTHROPIC_API_KEY на серверот</span>}
        {ai.lastFail && <span className="pill bad" title={ai.lastFail.detail}>{ai.lastFail.code === 'credit' ? 'кредитот е потрошен' : 'клучот е одбиен'} ({dmyHm(new Date(ai.lastFail.at))})</span>}
        <span style={{ flex: 1 }} />
        {admin && <RowAction action={setAiEnabledAction.bind(null, !ai.enabled)} label={ai.enabled ? 'Исклучи AI читање' : 'Вклучи AI читање'} className="btn sm" showOk />}
        <Link className="btn sm ghost" href="/konvertor">🔄 Конвертор на датотеки</Link>
        {admin && <RowAction action={aiPingAction} label="🔎 Провери го AI-кредитот сега" className="btn sm pri" inline />}
      </div>
      {ping && (
        <p className="mini" style={{ margin: '6px 0 0' }}>
          Последна проверка{ping.auto ? ' (автоматска)' : ''}: {dmyHm(new Date(ping.at))} – {ping.msg}
        </p>
      )}
      <p className="note" style={{ margin: '6px 0 0' }}>
        Кога AI е исклучено (или кредитот е потрошен), полињата за прикачување и понатаму примаат датотеки: изводите, бруто билансите и фактурите
        од Excel/CSV/XML и PDF со текст се читаат без AI; скенираните документи и сликите бараат AI.
        {ai.lastFail?.code === 'credit' && <> {AI_ERR_MSG.credit}</>}
        {ai.lastFail && <> По дополнувањето кликнете „🔎 Провери го AI-кредитот сега“ – AI веднаш продолжува (програмата проверува и сама, најмногу на секои 2 минути).</>}
      </p>
    </div>
  );
}
