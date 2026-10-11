/**
 * Legacy `VIEWS.arNewNav` 12781 → `ACT.arNew` 12782 → `dosNew` with `S.arBack` — Архива › 📷 Скенирај / прикачи нов
 * документ: the dossier's new-document form (same action as `/dosie`), opened on its own with the way back to the
 * archive. The scan center (`/skan`) is for accounting documents that the AI reads; this item files a document.
 */
import Link from 'next/link';
import { can } from '@wise/core';
import { DOS_CAT } from '@wise/core/office';
import { officePage } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { UploadField } from '@/components/upload-field';
import { saveDossierDoc } from '../dosie/actions';

export default async function ArNewPage() {
  const { u, firm } = await officePage('arNewNav');
  const t = '📷 Скенирај / прикачи нов документ';
  if (!firm) return <NoFirm t={t} />;
  const write = can(u.principal, 'write', firm.id);
  return (
    <>
      <Hd t={t} sub={firm.name}>
        <Link className="btn" href="/arhiva">← Архива</Link>
        <Link className="btn" href="/dosie">🗂 Досие</Link>
        <Link className="btn" href="/skan">Скенирање сметководствен документ</Link>
      </Hd>
      {!write ? <div className="callout warn">Немате право на внес.</div> : (
        <ActionForm action={saveDossierDoc}>
          <h2>Нов документ во досието на фирмата</h2>
          <div className="form">
            <label className="f">Категорија<select name="category" required defaultValue="">
              <option value="" disabled>— изберете —</option>
              {DOS_CAT.map((c) => <option key={c}>{c}</option>)}
            </select></label>
            <label className="f">Наслов<input name="title" placeholder="на пр. Тековна состојба" /></label>
            <label className="f">Број<input name="number" /></label>
            <label className="f">Датум<input name="date" type="date" /></label>
            <label className="f">Важи до<input name="validTo" type="date" /></label>
            <label className="f wide">Белешка<input name="note" /></label>
            <UploadField firmId={firm.id} capture accept="image/*,application/pdf" label="📎 Прикачи датотеки (PDF, слики)" />
          </div>
          <div className="row"><button className="btn pri">Зачувај</button></div>
        </ActionForm>
      )}
      <p className="note">Фактури, изводи и сметки што треба да се прочитаат и прокнижат се внесуваат во <Link href="/skan">Скенирање документ</Link>; тука се архивираат документите на фирмата (решенија, договори, тековни состојби…). Сите прикачени датотеки се гледаат во <Link href="/arhiva">Архива на документи</Link>.</p>
    </>
  );
}
