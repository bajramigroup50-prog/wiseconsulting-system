/** The officer's documented decision on an alert / internal report (`amlDecide`). */
import { ActionForm } from '@/components/action-form';
import { amlDecide } from './ufr-actions';

export function DecideForm({ id, cash }: { id: string; cash?: boolean }) {
  return (
    <ActionForm action={amlDecide} className="" style={{ minWidth: 260 }}>
      <input type="hidden" name="id" value={id} />
      <select name="result" defaultValue="" style={{ width: '100%' }} required>
        <option value="" disabled>— одлука —</option>
        <option value="none">Нема основи за сомневање (затвори)</option>
        <option value="str">Сомневање → извештај до УФР (STR, 24 часа)</option>
        {cash && <option value="ctr">Готовинска трансакција → извештај до УФР (3 работни дена)</option>}
        {cash && <option value="strctr">И двата извештаи</option>}
      </select>
      <textarea name="reason" rows={2} placeholder="Образложение (проверено: …; заклучок: …)" style={{ width: '100%', font: 'inherit', marginTop: 4 }} required />
      <button className="btn sm pri" style={{ marginTop: 4 }}>Евидентирај одлука</button>
    </ActionForm>
  );
}
