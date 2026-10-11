'use client';
/**
 * Firm editor — legacy `firmForm` 6833 with all four tabs (Основни / Дополнителни / Плата / е-Фактура), the
 * „Сметководствени услуги“ fee box (patch 13587), logo / signature / stamp images, invoice look with preview,
 * „Копирај составувач → одговорно лице“, „Избриши фирма“ and „📷 Пополни од решение“ (new firm).
 * Every tab stays mounted (hidden), so one submit saves all of them, like legacy `firmFormVals`.
 */
import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';
import type { Firm } from '@wise/db';
import { FIRM_TABS, FIRM_VAT_RATES, vOk, type FirmTab } from '@wise/core/firms/firmform';
import { lfGuess } from '@wise/core/firms/resh';
import { INV_NOTE0 } from '@wise/core/sales/docs';
import { YE_LEGAL_FORMS } from '@wise/core/yearend/entity';
import { uploadFile } from '@/lib/upload';
import { saveFirm, deleteFirm, type FirmFormState } from './actions';

type S = Record<string, unknown>;

export function FirmForm({ firm: d, withFee, feeNote, canDelete, canResh }: {
  firm: Firm | null; withFee: boolean; feeNote: string; canDelete: boolean; canResh: boolean;
}) {
  const [st, action, pending] = useActionState<FirmFormState, FormData>(saveFirm, {});
  const [tab, setTab] = useState<FirmTab>('osn');
  const s = (d?.settings ?? {}) as S;
  const formRef = useRef<HTMLFormElement>(null);
  const v = (k: string, def = ''): string => {
    if (k in (d ?? {}) && typeof (d as unknown as S)[k] !== 'object') return String((d as unknown as S)[k] ?? def);
    const x = s[k];
    return x == null || x === '' ? def : String(x);
  };
  const I = ({ k, l, b, w, ph, type, def, max }: { k: string; l: string; b?: boolean; w?: boolean; ph?: string; type?: string; def?: string; max?: number }) => (
    <label className={`fl${b ? ' b' : ''}${w ? ' w' : ''}`}>
      <span>{l}</span>
      <input name={k} defaultValue={v(k, def)} placeholder={ph} type={type} maxLength={max} />
    </label>
  );
  const R = ({ k, l, opts, def }: { k: string; l: string; opts: [string, string][]; def: string }) => (
    <fieldset className="fs"><legend>{l}</legend>
      {opts.map(([val, n]) => <label key={val} className="rb"><input type="radio" name={k} value={val} defaultChecked={v(k, def) === val} /> {n}</label>)}
    </fieldset>
  );
  const Y = ({ k, l, def = 'Н', opts = [['Д', 'Д – да'], ['Н', 'Н – не']] }: { k: string; l: string; def?: string; opts?: [string, string][] }) => (
    <fieldset className="fs"><legend>{l}</legend>
      <select name={k} defaultValue={v(k, def)} style={{ width: 'auto' }}>{opts.map(([val, n]) => <option key={val} value={val}>{n}</option>)}</select>
    </fieldset>
  );
  const Small = ({ k, l, note }: { k: string; l: string; note: string }) => (
    <div className="fl"><span>{l}</span><div className="row" style={{ flexWrap: 'nowrap' }}>
      <input name={k} defaultValue={v(k)} style={{ maxWidth: 80 }} /><small className="note">{note}</small>
    </div></div>
  );
  const pane = (id: FirmTab, children: React.ReactNode) => <div className="fpane" data-pane={id} hidden={tab !== id}>{children}</div>;

  const vatIn = (s.vatIn ?? {}) as Record<string, string>, vatOut = (s.vatOut ?? {}) as Record<string, string>;

  function copyDC() {
    const f = formRef.current; if (!f) return;
    for (const k of ['first', 'last', 'city', 'street', 'no', 'phone', 'mob']) {
      const a = f.elements.namedItem('dc_' + k) as HTMLInputElement | null, b = f.elements.namedItem('ro_' + k) as HTMLInputElement | null;
      if (a && b && !b.value) b.value = a.value;
    }
  }
  function preview() {
    const f = formRef.current; if (!f) return;
    const fd = new FormData(f);
    const q = new URLSearchParams();
    for (const k of ['invStyle', 'invColor', 'invNote', 'legalFoot', 'logo', 'sign', 'stamp', 'signer', 'signerRole', 'bank', 'bankName']) q.set(k, String(fd.get(k) ?? ''));
    q.set('qr', fd.get('qr') === 'on' ? '1' : '0');
    if (d) q.set('firm', d.id);
    window.open('/print/firmPregled?' + q.toString(), '_blank');
  }

  if (st.cred) return (
    <div className="card callout good">
      <h2>✓ {st.ok}</h2>
      <p>Креиран е и профил за клиентот „{st.cred.firm}“ (клиентски портал): корисник <b>{st.cred.username}</b> · лозинка <b>{st.cred.password}</b></p>
      <p className="note">Лозинката се прикажува само сега – запишете ја или испечатете ја од Клиенти › Профили. При првата најава клиентот ја менува.</p>
      <div className="row"><Link className="btn pri" href="/">Отвори ја фирмата</Link><Link className="btn" href="/klProfili">Профили на клиенти</Link></div>
    </div>
  );
  return (
    <form ref={formRef} className="card firmcard" action={action}>
      {d && <input type="hidden" name="id" value={d.id} />}
      <input type="hidden" name="withFee" value={withFee ? '1' : ''} />
      <div className="hd">
        <h2>{d ? 'Промена на податоци на фирмата' : 'Нова фирма'}</h2>
        <div className="row">
          {!d && canResh && <Link className="btn pri" style={{ fontWeight: 700 }} href="/firmiResh" title="Скенирајте го решението од ЦРМ – податоците се пополнуваат сами">📷 Пополни од решение (скенирај)</Link>}
          {d && canDelete && <DeleteFirm id={d.id} name={d.name} edb={d.edb} />}
          <Link className="btn" href="/firmi">Излез</Link>
          <button className="btn pri" disabled={pending}>Во ред · зачувај</button>
        </div>
      </div>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good">{st.ok}</div>}
      <div className="ftabs" role="tablist">
        {FIRM_TABS.map(([id, n]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{n}</button>)}
      </div>

      {pane('osn', <div className="fgrid"><div className="fcol">
        <I k="code" l="Шифра" b />
        <I k="name" l="ИМЕ (целосен назив)" b w ph="на пр. БАЈРАМИ ГРОУП ДООЕЛ" />
        <label className="fl b w"><span>Правна форма / вид</span>
          <select name="legalForm" defaultValue={d?.legalForm || lfGuess(d?.name ?? '')}>
            {YE_LEGAL_FORMS.map(([g, L]) => <optgroup key={g} label={g}>{L.map(([val, n]) => <option key={val} value={val}>{n}</option>)}</optgroup>)}
          </select>
        </label>
        <I k="address" l="Адреса" w />
        <I k="city" l="Град" />
        <I k="phone" l="Телефон" />
        <I k="fax" l="Факс" />
        <I k="phone2" l="Дополнителен телефон / мобилен" />
        <div className="fl"><span>Жиро сметка</span><div className="row" style={{ flexWrap: 'nowrap' }}>
          <input name="bank" defaultValue={v('bank') || v('bankAccount')} />
          <Link className="btn sm" href="/banka" title="Сите банкарски сметки на фирмата">Жиро сметки…</Link>
        </div></div>
        <I k="realBank" l="Реална жиро с-ка" b />
        <I k="bank2" l="Доп. жиро с-ка" />
        <I k="embs" l="Матичен број" />
        <I k="regNo" l="Регистерски број" />
        <I k="edb" l="Даночен број" ph="MK4030…" />
        <I k="bankName" l="Банка" b />
        <I k="bankName2" l="Доп. банка" />
        <I k="bankEdb" l="Дан. бр. на банката" />
        <I k="bankAcc" l="Жиро с-ка на банката" />
        <I k="depositor" l="Депозитор на банката" />
        <I k="activity" l="Шифра на дејност" ph="на пр. 69.20" />
        <Small k="opstina" l="Општина" note="за фирми и за ПИО (СТД и доп. дејн.)" />
        <Small k="opstina2" l="Општина 2" note="за здравство само за СТД и доп. дејност" />
        <I k="payCode" l="Код за плата" def="0" />
        <Small k="opstinaOther" l="Општина за друг град" note="празно за Скопје" />
        <I k="contact" l="Лице за контакт" />
        <I k="email" l="Е-маил" type="email" />
        <I k="short" l="Краток назив (на фактури и документи)" />
        <fieldset className="fs"><legend>Потписник на фактури – име, презиме, статус</legend>
          <I k="signer" l="Име и презиме" w />
          <div className="row">{['Овластено лице', 'Управител'].map((x) => <label key={x} className="rb"><input type="radio" name="signerRole" value={x} defaultChecked={v('signerRole', 'Управител') === x} /> {x}</label>)}</div>
        </fieldset>
      </div><div className="fcol side">
        <fieldset className="fs"><legend>Контен план</legend><select name="kontoPlan" defaultValue="std"><option value="std">0 – Стандарден (174/2011)</option></select></fieldset>
        {withFee && (
          <fieldset className="fs"><legend>Сметководствени услуги (наш надоместок)</legend>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="f" style={{ flex: 1, minWidth: 150 }}>Месечно без ДДВ<input name="accFee" type="number" step="any" defaultValue={v('accFee')} placeholder="на пр. 3000" /></label>
              <label className="f" style={{ flex: 1, minWidth: 150 }}>Фактурирај од<input name="accFrom" type="date" defaultValue={v('accFrom')} /></label>
            </div>
            <small className="note">{feeNote}</small>
          </fieldset>
        )}
        <R k="repro" l="Репро зависност" opts={[['nedef', 'Недефинирано'], ['zav', 'Зависни'], ['nezav', 'Независни']]} def="nedef" />
        <fieldset className="fs"><legend>ДДВ и години</legend>
          <label className="chk"><input type="checkbox" name="vatRegistered" defaultChecked={d?.vatRegistered ?? true} /> Регистрирана за ДДВ</label>
          <label className="fl"><span>Даночен период</span>
            <select name="vatPeriod" defaultValue={d?.vatPeriod ?? 'quarter'}>
              <option value="quarter">Тримесечен (≤ 25 мил.)</option>
              <option value="month">Месечен (&gt; 25 мил.)</option>
            </select>
          </label>
          <label className="fl"><span>ДДВ обврзник од</span><input name="vatFrom" type="date" defaultValue={v('vatFrom')} /></label>
          <I k="gdvpYear" l="Година од која плаќа ГДВП" max={4} />
          <I k="curYear" l="Тековна година" def={String(new Date().getFullYear())} max={4} />
          <I k="parent" l="Фирма родител (од минатата година)" />
          <label className="fl"><span>Заклучен период до</span><input name="lockDate" type="date" defaultValue={d?.lockDate ?? ''} /></label>
        </fieldset>
        <label className="chk"><input type="checkbox" name="transport" defaultChecked={s.transport === true} /> Распоред на транспортни трошоци по количини</label>
        <fieldset className="fs"><legend>Фактура: лого, потпис, печат и напомена</legend>
          <ImgField k="logo" t="Лого (горе лево на фактурата)" v={v('logo')} firmId={d?.id ?? null} />
          <ImgField k="sign" t="Потпис – слика или PDF (над „Фактурирал“)" v={v('sign')} firmId={d?.id ?? null} />
          <ImgField k="stamp" t="Печат (на „М.П.“)" v={v('stamp')} firmId={d?.id ?? null} />
          <p className="note" style={{ margin: '0 0 8px' }}>Може слика (PNG/JPG) или <b>PDF</b> (скениран потпис/печат на бела хартија).</p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '0 0 8px', alignItems: 'end' }}>
            <label className="fl"><span>Изглед на фактурата</span>
              <select name="invStyle" defaultValue={v('invStyle', 'classic')}>
                <option value="classic">Класичен (табели)</option><option value="modern">Модерен (боја, картички)</option><option value="minimal">Минималистички (црно-бел)</option>
              </select>
            </label>
            <label className="fl"><span>Боја</span><input type="color" name="invColor" defaultValue={v('invColor', '#1f5eff')} style={{ width: 60, height: 34, padding: 2 }} /></label>
            {d && <button className="btn sm" type="button" onClick={preview}>👁 Преглед</button>}
          </div>
          <label className="chk" style={{ margin: '0 0 8px' }}><input type="checkbox" name="qr" defaultChecked={s.qr !== false} /> Прикажи QR код на фактурата (износ, жиро сметка, повикување на број)</label>
          <label className="fl" style={{ display: 'block' }}><span>Напомена на дното на фактурата</span>
            <textarea name="invNote" rows={4} style={{ width: '100%' }} defaultValue={s.invNote == null ? INV_NOTE0 : String(s.invNote)} />
          </label>
        </fieldset>
        <fieldset className="fs"><legend>Законска забелешка за потпис и печат (на дното на фактурата)</legend>
          <select name="legalFoot" defaultValue={v('legalFoot', 'auto')} style={{ width: 'auto' }}>
            <option value="auto">Автоматски (без печат → „печатот не е задолжителен“; со е-сертификат → квалификуван е-потпис)</option>
            <option value="paper">Хартиена / PDF: печатот не е задолжителен (чл. 53 ЗДДВ)</option>
            <option value="esign">Електронска фактура со квалификуван е-потпис (чл. 53-б ЗДДВ)</option>
            <option value="none">Без забелешка</option>
          </select>
        </fieldset>
      </div></div>)}

      {pane('dop', <>
        <div className="fgrid3">
          <div className="fcol">
            <Y k="retailCode" l="Шифра во малопродажба" def="Д" />
            <R k="serial" l="Сериски бр. – статус" opts={[['rok', 'Рокови'], ['ser', 'Сериски број'], ['vel', 'Величини'], ['lot', 'Лотови'], ['nedef', 'Недефиниран']]} def="nedef" />
          </div>
          <div className="fcol">
            <I k="instTo" l="Инст. за која се однесува" ph="пр. ТРЗ, ФЗМ" />
            <I k="debitAcct" l="Сметка која се задолжува" />
            <I k="payForm" l="Вид образец плати" ph="пр. 60, 62, 92" />
            <I k="contribForm" l="Вид образец придонеси" ph="пр. 70, 76" />
            <I k="payslip" l="Исплатно ливче (образец)" />
            <I k="accReg" l="Регистерски број за сметководители" />
          </div>
          <div className="fcol"><fieldset className="fs"><legend>Обрасци</legend><p className="note" style={{ margin: 0 }}>Фактура, испратница, услужна, девизна, одобрение и документите за малопродажба се печатат со вградените обрасци на програмот (со лого, ДДВ по стапки и член 32-а). Не треба посебна датотека .fr3.</p></fieldset></div>
        </div>
        <h3 className="fh">Конта за ДДВ по стапки</h3>
        <p className="note" style={{ marginTop: 0 }}>Празно = стандардно: претходен ДДВ 18% → 130018, 10% → 130010, 5% → 13005; обврска 18% → 230018, 10% → 230010, 5% → 23005. Збирните конта 2300/2301/2302 и 1300/1301/1302 не се користат.</p>
        <div className="fgrid2">
          {FIRM_VAT_RATES.map(([r, di, dout]) => (
            <span key={r} style={{ display: 'contents' }}>
              <label className="fl"><span>Претходен ДДВ {r}%</span><input name={`vin_${r}`} defaultValue={vOk(vatIn[r]) ? vatIn[r] : ''} placeholder={di} /></label>
              <label className="fl"><span>Обврска за ДДВ {r}%</span><input name={`vout_${r}`} defaultValue={vOk(vatOut[r]) ? vatOut[r] : ''} placeholder={dout} /></label>
            </span>
          ))}
          <label className="fl"><span>или сите претходни на едно конто</span><input name="vatInKonto" defaultValue={v('vatInKonto')} placeholder="на пр. 1300" /></label>
        </div>
        <h3 className="fh">ДДВ пријава – податоци за составувач</h3>
        <div className="fgrid2">
          <I k="dc_name" l="Назив" /><I k="dc_edb" l="ЕДБ / ЕМБГ" /><I k="dc_first" l="Име" /><I k="dc_last" l="Презиме" /><I k="dc_street" l="Улица" />
          <I k="dc_no" l="Број" /><I k="dc_phone" l="Телефон" /><I k="dc_mob" l="Моб. тел" /><I k="dc_city" l="Нас. место" />
        </div>
        <h3 className="fh">Податоци за одговорно лице</h3>
        <div className="fgrid2">
          <I k="ro_first" l="Име" /><I k="ro_last" l="Презиме" /><I k="ro_city" l="Нас. место" /><I k="ro_embg" l="ЕМБГ" />
          <I k="ro_street" l="Улица" /><I k="ro_no" l="Број" /><I k="ro_phone" l="Телефон" /><I k="ro_mob" l="Моб. тел" />
        </div>
        <div className="row"><button className="btn sm" type="button" onClick={copyDC}>Копирај составувач → одговорно лице</button></div>
      </>)}

      {pane('pl', <div className="fgrid3">
        <div className="fcol">
          <R k="payType" l="Тип" opts={[['firma', 'Фирма'], ['std', 'С.Т.Д.'], ['dop', 'Дополн. дејност'], ['tirz', 'ТИРЗ']]} def="firma" />
          <Y k="craft" l="Занаетчија" />
          <Y k="protect" l="Заштитна" def="" opts={[['', '—'], ['Д', 'Д – да'], ['Н', 'Н – не']]} />
          <Y k="taxPayer" l="Даночен обврзник" def="Д" />
          <R k="avgMode" l="Просек од минати плати" opts={[['plata', 'По просечна плата'], ['saat', 'По просечна саатнина']]} def="saat" />
        </div>
        <div className="fcol"><Y k="payLocked" l="Заклучена" /><Y k="lawyer" l="Адвокат" /></div>
      </div>)}

      {pane('ef', <div className="fcol" style={{ maxWidth: 520 }}>
        <I k="ef_taxNo" l="Даночен број на испраќач" def={d?.edb ?? ''} />
        <I k="ef_contact" l="Контакт на испраќач" />
        <I k="ef_email" l="E-mail на испраќач" def={d?.email ?? ''} />
        <I k="epdd" l="ЕПДД ИД" />
        <fieldset className="fs"><legend>Регистриран сертификат во Е-ФАКТУРА</legend><I k="cert_serial" l="Сериски број" /><I k="cert_thumb" l="Thumbprint" /></fieldset>
        <p className="note">Овие податоци ќе се користат при електронско испраќање на фактури до системот е-Фактура на УЈП.</p>
      </div>)}
    </form>
  );
}

/** Logo / signature / stamp: upload to the file store, keep the file id in a hidden input; „Отстрани“ clears it. */
function ImgField({ k, t, v, firmId }: { k: string; t: string; v: string; firmId: string | null }) {
  const [id, setId] = useState(v);
  const [msg, setMsg] = useState('');
  const src = id ? (/^[0-9a-f-]{36}$/i.test(id) ? `/api/files/${id}` : id) : '';
  return (
    <div style={{ margin: '0 0 10px' }}>
      <div className="mini" style={{ marginBottom: 4 }}>{t}</div>
      <input type="hidden" name={k} value={id} />
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" style={{ maxWidth: 260 }}
          onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            setMsg('Се прикачува…');
            const r = await uploadFile(f, firmId);
            if (r.ok) { setId(r.id); setMsg(''); } else setMsg('Сликата не може да се прочита: ' + r.error);
            e.target.value = '';
          }} />
        {src && <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" style={{ maxHeight: 56, maxWidth: 180, background: '#fff', padding: 4, border: '1px solid var(--line)', borderRadius: 6 }} />
          <button className="btn sm danger" type="button" onClick={() => setId('')}>Отстрани</button>
        </>}
        {msg && <span className="note">{msg}</span>}
      </div>
    </div>
  );
}

/**
 * Legacy `delFirm` (final patch 12794): admin only, two confirmations. It sits inside the firm form, so it is a submit
 * button with its own `formAction` (a nested <form> is invalid HTML and broke hydration); the firm form carries `id`.
 */
function DeleteFirm({ name, edb }: { id: string; name: string; edb: string | null }) {
  const [st, act, pending] = useActionState<FirmFormState, FormData>(deleteFirm, {});
  return (
    <>
      <button className="btn danger" formAction={act} formNoValidate disabled={pending} title={st.error} onClick={(e) => {
        const ok1 = confirm(`Да се избрише фирмата „${name}“${edb ? ` (ЕДБ ${edb})` : ''} со СИТЕ документи, налози, изводи, залиха и плати?`);
        const ok2 = ok1 && confirm(`⚠ ПОСЛЕДНА ПОТВРДА

Фирма: ${name}
${edb ? `ЕДБ: ${edb}
` : ''}
Фирмата станува НЕАКТИВНА (податоците остануваат и може повторно да се активира од листата „Неактивни фирми“).

Да се деактивира?`);
        if (!ok2) e.preventDefault();
      }}>⏸ Деактивирај фирма</button>
      {st.error && <span className="note bad"> {st.error}</span>}
    </>
  );
}
