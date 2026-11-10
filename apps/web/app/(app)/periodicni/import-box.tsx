'use client';
/**
 * „📥 Периодични од Excel“ with „Фактурирање од месец“: the client's list can be imported in December and invoiced from
 * January – every customer's first invoice is its invoicing day in that month (or later), never earlier.
 */
import { useState } from 'react';
import { XlsxImport } from '@/components/list-tools';
import type { ActionState } from '@/lib/books';

import type { Cell } from '@/components/list-tools';

export function RecImportBox({ action, template, firstMonth }: {
  action: (p: ActionState, f: FormData) => Promise<ActionState>; template: Cell[][]; firstMonth: string;
}) {
  const [start, setStart] = useState(firstMonth);
  return (
    <span className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', display: 'inline-flex' }}>
      <label className="mini" title="Првата фактура на секој купувач е неговиот ден за фактурирање во овој месец (или подоцна)">
        Фактурирање од месец{' '}
        <input type="month" value={start} min={firstMonth} onChange={(e) => setStart(e.target.value || firstMonth)} style={{ width: 150 }} />
      </label>
      <XlsxImport action={action} template={template} templateName="Periodicni_obrazec.xlsx" label="📥 Периодични од Excel" fields={{ start }} />
    </span>
  );
}
