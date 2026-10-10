/** Legacy `VIEWS.bkUnl` 12513 (плаќања на комитент без фактура → рачно затворање) is part of /bkAdv („Затвори рачно“). */
import { redirect } from 'next/navigation';

export default function BkUnlPage() { redirect('/bkAdv'); }
