/** Legacy `VIEWS.ddvTab` 16812 (табела ДДВ по месеци за инспектор) is ported as the `insp` tab of /ddv. */
import { redirect } from 'next/navigation';

export default function DdvTabPage() { redirect('/ddv?tab=insp'); }
