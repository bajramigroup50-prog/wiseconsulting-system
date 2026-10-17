/**
 * „📥 Пристигнати документи“ — who sees what (pure, unit-tested):
 *  - a user sees the files of the firms they may access only (`allowedFirms`: assigned / all, never a demo firm for a
 *    real user, only the demo firms for a 🎭 demo user);
 *  - the office-wide files (uploaded without a firm, unassigned МПИН) only the owner and the admins who are not
 *    limited by 🔒 „Колегите гледаат само сметководство“ — never a demo user;
 *  - the МПИН rows only who may open the МПИН screen (`mpinIn`, hidden from book-only colleagues).
 */
export interface InboxScope { firmIds: string[]; office: boolean; mpin: boolean }

export function inboxScope(u: { role: string; demo?: boolean | null }, o: { firmIds: readonly string[]; restricted: ReadonlySet<string> | null; owner: boolean }): InboxScope {
  if (u.role === 'klient' || u.role === 'teren') return { firmIds: [], office: false, mpin: false };
  const office = !u.demo && (o.owner || (u.role === 'admin' && o.restricted === null));
  const mpin = !u.demo && (o.restricted === null ? u.role !== 'view' : o.restricted.has('mpinIn'));
  return { firmIds: [...o.firmIds], office, mpin };
}

/** Where a stored route reference opens (`ai_document:<id>`, `dossier_doc:<id>`, `mpin_inbox:<id>`, `bank_import:<batch>`). */
export function routeRefLink(ref: string | null | undefined, route?: string | null, numbers?: readonly string[]): { href: string; label: string } | null {
  if (!ref) return null;
  const [t] = ref.split(':');
  if (t === 'ai_document') return route === 'sale' ? { href: '/skan?k=sale', label: '🧾 Преглед (излезни)' } : { href: '/skan', label: '🧾 Преглед на скенирани' };
  if (t === 'dossier_doc') return { href: '/dosie', label: '🗂 Досие' };
  if (t === 'mpin_inbox') return { href: '/mpinIn', label: '🧮 МПИН' };
  if (t === 'bank_import') return numbers?.length ? { href: `/nalozi?n=${encodeURIComponent(numbers[0]!)}`, label: `📒 Налог ${numbers.join(', ')}` } : { href: '/banka', label: '🏦 Изводи' };
  return null;
}
