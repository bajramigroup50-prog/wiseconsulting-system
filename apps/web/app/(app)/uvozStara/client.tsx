'use client';
/** Client parts of the legacy import page: the upload form and the auto-refresh while a run is working. */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm, Submit } from '@/components/action-form';
import { UploadField } from '@/components/upload-field';
import { startLegacyImport } from './actions';

export function ImportForm() {
  return (
    <ActionForm action={startLegacyImport} reset={false}>
      <h2>1. Прикачете ги резервните копии</h2>
      <p className="note">
        ZIP од „⬇ Последната копија (ZIP)“ (сите фирми) и/или JSON од „⬇ Само оваа фирма (JSON)“ – може повеќе датотеки одеднаш.
        Ако една фирма е во повеќе датотеки, се увезува најновата копија.
      </p>
      <UploadField firmId={null} name="fileIds" label="📎 Избери датотеки (.zip, .json)" accept=".zip,.json,application/zip,application/json" />
      <h2 style={{ marginTop: 12 }}>2. Опции</h2>
      <label className="chk"><input type="checkbox" name="vatBaseLines" defaultChecked /> Книжи ги и вонбилансните ставки за основица на ДДВ (994/999), како старата програма</label>
      <label className="chk"><input type="checkbox" name="users" defaultChecked /> Увези корисници (само ако датотеката ги содржи – целосен извоз)</label>
      <div className="row" style={{ marginTop: 10 }}><Submit>📥 Започни увоз</Submit></div>
    </ActionForm>
  );
}

/** Refresh the server component every few seconds while the run is queued or running. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
