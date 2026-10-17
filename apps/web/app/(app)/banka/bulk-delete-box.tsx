'use client';
/** „🗑 Избриши ги сите изводи“: bank account (or all) + date range → preview in the confirm → one-transaction delete. */
import { useState } from 'react';
import { RowAction } from '@/components/row-action';
import { bulkDeleteStatementsAction, bulkDeleteStatementsPreviewAction } from './actions';

export function BulkDeleteStatementsBox({ accounts, fx, year, acct }: { accounts: { id: string; name: string }[]; fx: boolean; year: number; acct?: string }) {
  const [a, setA] = useState(acct && accounts.some((x) => x.id === acct) ? acct : accounts.length > 1 ? 'all' : accounts[0]?.id ?? 'all');
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const input = { acct: a, fx, from, to };
  return (
    <details className="card" style={{ margin: '6px 0' }}>
      <summary className="mini" style={{ cursor: 'pointer' }}>🗑 Избриши ги сите изводи (по сметка и период)…</summary>
      <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 }}>
        <label className="f">Сметка<select value={a} onChange={(e) => setA(e.target.value)}>
          <option value="all">— сите сметки —</option>
          {accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select></label>
        <label className="f">Од<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="f">До<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <RowAction className="btn danger" inline showOk
          action={() => bulkDeleteStatementsAction(input)} preview={() => bulkDeleteStatementsPreviewAction(input)}
          label="🗑 Избриши ги сите изводи"
          title="Ги брише сите изводи (непрокнижени и прокнижени, со нивните налози) на сметката во периодот; изводите во заклучен период се прескокнуваат"
          confirm="Да се избришат сите изводи во избраниот период?" />
      </div>
    </details>
  );
}
