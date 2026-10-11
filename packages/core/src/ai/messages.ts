/** Legacy user texts around the automatic reading (scanFile 13540, readAtt, impRead / empRead summaries). */

/** Legacy `scanFile` without AI: the file is attached, the amounts are entered by hand. */
export const AI_UNAVAILABLE_MSG = 'Автоматското читање не е достапно; документот е прикачен, внесете ги износите рачно.';

/** Legacy `readAtt`: the attached file cannot be opened for reading. */
export const AI_OPEN_FAILED_MSG = 'Документот не може да се отвори за читање.';

/** Legacy summary callout after a read: „Прочитано: …“ + what to check (purchase costs / employees). */
export function aiReadDoneMsg(done: readonly string[], kind: 'amounts' | 'data' = 'amounts'): string {
  const tail = kind === 'data' ? 'Проверете ги податоците (Измени) пред пресметката.' : 'Проверете ги износите, додадете ги артиклите без шифра во шифрарникот и зачувајте.';
  return `Прочитано: ${done.join(' · ')}. ${tail}`;
}

/** The server's „no API key“ error is shown with the legacy text. */
export const isAiUnavailable = (msg: string | null | undefined) => /^Автоматското читање не е достапно/.test(String(msg ?? ''));
