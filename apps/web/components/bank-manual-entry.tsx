'use client';
/**
 * „✍️ Рачна ставка“ on /banka, /devizni and in „Изводи во налогот“: the fast-entry dialog in bank mode. The line is
 * added to the chosen statement (account + date; a new date opens a new statement, „Извод број“ numbers it) through
 * `addManualLineAction`; Должи on the counter konto = ОДЛИВ, Побарува = ПРИЛИВ — the bank konto side is automatic.
 * F9 adds the line and keeps the dialog open for the next one (same statement), Esc closes.
 */
import { useRouter } from 'next/navigation';
import { addManualLineAction } from '@/app/(app)/banka/actions';
import { FastEntry, bankLineForm, type FastLine, type OpenDoc } from './fast-entry';
import type { PickerPartner } from './partner-picker';

export interface BmeAccount { id: string; label: string; konto: string; cur: string }
export interface BmeStatement { id: string; acct: string; no: string; date: string; net: number; lines: number }

const dmy = (d: string) => d.split('-').reverse().join('.');

export function BankManualEntry({ accounts, statements, docs, chart, partners, initial, closeHref, onClose }: {
  accounts: BmeAccount[]; statements: BmeStatement[]; docs?: OpenDoc[]; chart: [string, string][]; partners: PickerPartner[];
  /** Defaults of the first line: account, date, statement number. */
  initial: Partial<FastLine>;
  closeHref?: string; onClose?: () => void;
}) {
  const router = useRouter();
  const close = () => { if (onClose) onClose(); else if (closeHref) router.push(closeHref); };
  const acctOf = (id: string) => accounts.find((a) => a.id === id) ?? accounts[0];
  const stOf = (l: Pick<FastLine, 'acct' | 'date'>) => statements.find((s) => s.acct === l.acct && s.date === l.date);
  const a0 = acctOf(initial.acct ?? '');
  const fx = !!a0 && a0.cur !== 'MKD';
  const save = async (l: FastLine) => {
    const a = acctOf(l.acct);
    if (!a) return 'Нема банкарска сметка.';
    const f = bankLineForm({ ...l, acct: a.id }, { fx: a.cur !== 'MKD', docs });
    if (typeof f === 'string') return f;
    const r = await addManualLineAction({}, f);
    if (r.error) return r.error;
    router.refresh();
  };
  return (
    <FastEntry mode="new" title="Нова ставка во извод" chart={chart} partners={partners} fx={fx} showStNo docs={docs}
      initial={{ cur: fx ? a0!.cur : '', ...initial, acct: initial.acct || a0?.id || '' }}
      bank={{
        konto: a0?.konto ?? '',
        accounts: accounts.map((a) => ({ id: a.id, label: a.label, konto: a.konto })),
        statements: statements.map((s) => ({ key: s.id, acct: s.acct, no: s.no, date: s.date, label: `Извод бр. ${s.no || '—'} од ${dmy(s.date)} · ${acctOf(s.acct)?.label ?? ''}` })),
      }}
      saldo={(l) => stOf(l)?.net ?? 0} no={(l) => (stOf(l)?.lines ?? 0) + 1}
      onSave={save} onClose={close} />
  );
}
