/** Internal suspicion report (legacy `amlRepNew` form) + shared row types of the AML screens. */
import type { amlRecords, amlReports, Firm } from '@wise/db';
import { ActionForm } from '@/components/action-form';
import { amlRepNew } from './office-actions';

export type AmlRec = typeof amlRecords.$inferSelect;
export type AmlRep = typeof amlReports.$inferSelect;
export type AmlFirm = Pick<Firm, 'id' | 'name' | 'edb' | 'embs' | 'address' | 'city' | 'activity' | 'settings'>;

export const UFR_APP = 'https://ws-askmk.ufr.gov.mk/logon.html';

export function ReportForm({ firms: F }: { firms: { id: string; name: string }[] }) {
  return (
    <ActionForm action={amlRepNew}>
      <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Нова внатрешна пријава за сомневање</h2>
      <div className="form">
        <label className="f">Клиент<select name="firmId"><option value="">—</option>{F.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label className="f wide">Опис (што, кога, износ, кои лица, индикатор)<textarea name="text" rows={3} style={{ width: '100%', font: 'inherit' }} /></label>
      </div>
      <button className="btn pri" style={{ marginTop: 6 }}>🚩 Испрати до овластеното лице</button>
      <p className="mini" style={{ margin: '6px 0 0' }}>Овластеното лице ја анализира најдоцна следниот работен ден и, ако сомневањето е основано, ја известува УФР веднаш, а целосниот извештај го доставува најдоцна за 24 часа (чл. 65) преку <a href={UFR_APP} target="_blank" rel="noopener">системот на УФР</a>.</p>
    </ActionForm>
  );
}
