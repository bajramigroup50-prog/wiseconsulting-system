import 'server-only';
/** Messages of the НПО server actions in the screen's language (cookie `wise-lang`, set by the МК / SQ switch). */
import { cookies } from 'next/headers';
import { tr } from './npo-i18n';

export async function actT(): Promise<(s: string) => string> {
  return tr((await cookies()).get('wise-lang')?.value === 'sq' ? 'sq' : 'mk');
}
