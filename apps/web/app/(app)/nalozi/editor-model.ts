/** Journal-editor model shared by the server page and the client editor. */
export interface EditorRow { account: string; partnerId: string; debit: string; credit: string; note: string; doc: string }
export interface EditorJournal {
  id: string | null; number: string; date: string; description: string; periodFrom: string; periodTo: string; rows: EditorRow[];
}

export const blankRow = (account = ''): EditorRow => ({ account, partnerId: '', debit: '', credit: '', note: '', doc: '' });

/** Legacy `newJ` 7255: two rows 4400 / 1000. */
export const newJournal = (date: string): EditorJournal =>
  ({ id: null, number: '', date, description: '', periodFrom: '', periodTo: '', rows: [blankRow('4400'), blankRow('1000')] });
