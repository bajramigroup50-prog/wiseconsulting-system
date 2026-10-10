/** Legacy `VIEWS.tarifi` 12844 (Даночни тарифи – ДДВ конта) is ported as the `tarifi` tab of /ddv (`VatAccountsForm`). */
import { redirect } from 'next/navigation';

export default function TarifiPage() { redirect('/ddv?tab=tarifi'); }
