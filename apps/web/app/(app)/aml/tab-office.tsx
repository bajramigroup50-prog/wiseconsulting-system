/** 🏢 Канцеларија — the office as obliged entity: officer, program, own risk assessment, trainings, statements, internal control, lists. */
import { AML_SELF_FACTORS, AML_SPLIT_DAYS, amlSelfLevel, addMonths, type AmlCdd } from '@wise/core/office';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { dmy } from '@/components/hd';
import { OwnTplLinks } from '@/components/own-tpl-links';
import { AML_HRC_DEFAULT, type AmlOffice } from '@/lib/aml';
import { amlConfAdd, amlCtlSave, amlHrcSet, amlOffSet, amlProgSet, amlSelfSave, amlTrAdd } from './office-actions';
import { UFR_APP, type AmlRec } from './report-form';

const H2 = ({ children }: { children: React.ReactNode }) => <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{children}</h2>;
const LV = { low: ['низок', 'good'], mid: ['среден', 'warn'], high: ['висок', 'bad'] } as const;

export function TabOffice({ office: O, users: U, today, admin, records }: { office: AmlOffice; users: { id: string; name: string; role: string; active: boolean }[]; today: string; admin: boolean; records: AmlRec[] }) {
  const y = today.slice(0, 4);
  const tr = (O.tr ?? []).filter((t) => t.date.startsWith(y));
  const sl = O.self ? amlSelfLevel(O.self) : null;
  const cnt = (l: string) => records.filter((r) => r.level === l && !(r.data as AmlCdd).relEnd).length;
  return (
    <>
      <ActionForm action={amlOffSet} reset={false}>
        <H2>Овластено лице и заменик (чл. 68)</H2>
        {!admin && <p className="mini">Ги определува сопственикот.</p>}
        <div className="form">
          <label className="f">Овластено лице<input name="officer" defaultValue={O.officer ?? ''} /></label>
          <label className="f">Работно место<input name="offPos" defaultValue={O.offPos ?? ''} /></label>
          <label className="f">Телефон<input name="offPhone" defaultValue={O.offPhone ?? ''} /></label>
          <label className="f">Е-пошта<input name="offEmail" defaultValue={O.offEmail ?? ''} /></label>
          <label className="f">Корисник во програмата (пристап до модулот)<select name="offUid" defaultValue={O.offUid ?? ''}><option value="">—</option>{U.filter((x) => x.role !== 'klient' && x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="f">Заменик<input name="deputy" defaultValue={O.deputy ?? ''} /></label>
          <label className="f">Работно место на заменикот<input name="depPos" defaultValue={O.depPos ?? ''} /></label>
          <label className="f">Одлука бр.<input name="appointNo" defaultValue={O.appointNo ?? ''} /></label>
          <label className="f">Одлука од<input name="appointed" type="date" defaultValue={O.appointed ?? ''} /></label>
          <label className="f">Податоците доставени до УФР на<input name="ufrNotified" type="date" defaultValue={O.ufrNotified ?? ''} /></label>
        </div>
        <p className="mini" style={{ margin: '4px 0' }}>Услови: неосудувано лице, најмалку средно образование, стручно знаење; независност и пристап до сите податоци (чл. 68 ст.7, 10). Заменик не е потребен ако канцеларијата има само еден вработен (ст.2). Името и контактот, како и секоја промена, се доставуваат до УФР по електронски пат (ст.15).</p>
        <div className="row" style={{ gap: 6 }}><button className="btn pri">Зачувај</button><a className="btn" href="/amlDoc?d=odl" target="_blank" rel="noopener">🖨 Одлука за овластено лице</a></div>
      </ActionForm>

      <ActionForm action={amlProgSet} reset={false}>
        <H2>Програма за спроведување на мерките (чл. 12)</H2>
        <p style={{ margin: '0 0 6px' }}>Донесена: <b>{O.prog ? dmy(O.prog) : '—'}</b>{O.progNo ? ` бр. ${O.progNo}` : ''}{O.prog && addMonths(O.prog, 12) < today ? <Pill c="warn">преиспитај (постара од 12 месеци)</Pill> : null}</p>
        <div className="form">
          <label className="f">Датум на донесување<input name="prog" type="date" defaultValue={O.prog ?? ''} /></label>
          <label className="f">Број<input name="progNo" defaultValue={O.progNo ?? ''} /></label>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}><button className="btn pri">Евидентирај донесување</button><a className="btn" href="/amlDoc?d=prog" target="_blank" rel="noopener">🖨 Генерирај Програма (PDF)</a>
          <OwnTplLinks src="firm:" docs={['Одлука за овластено лице', 'Програма за спречување ПП/ФТ', 'Проценка на ризик на канцеларијата'].map((t) => ({ k: `d:${t}`, label: t }))} /></div>
        <p className="mini" style={{ margin: '4px 0 0' }}>Генерираната програма ги содржи сите задолжителни делови од чл. 12 и податоците од овој екран; прегледајте ја, потпишете ја и евидентирајте го датумот.</p>
      </ActionForm>

      <ActionForm action={amlSelfSave} reset={false}>
        <H2>Проценка на ризик на канцеларијата (чл. 11)</H2>
        <p style={{ margin: '0 0 6px' }}>Последна: <b>{O.self?.date ? dmy(O.self.date) : '—'}</b>{sl && <> · <Pill c={LV[sl.level][1]}>{LV[sl.level][0]} ({sl.avg})</Pill></>} · клиенти: висок {cnt('high')}, средно-висок {cnt('midhi')}, среден {cnt('mid')}, низок {cnt('low')}</p>
        <div className="tw"><table className="dense"><thead><tr><th>Група</th><th>Фактор</th><th>Ризик (1–3)</th></tr></thead><tbody>
          {AML_SELF_FACTORS.map(([k, g, l]) => <tr key={k}><td>{g}</td><td>{l}</td><td><select name={`s_${k}`} defaultValue={String(O.self?.scores?.[k] ?? 2)}><option value="1">1 – низок</option><option value="2">2 – среден</option><option value="3">3 – висок</option></select></td></tr>)}
        </tbody></table></div>
        <div className="form">
          <label className="f">Датум<input name="date" type="date" defaultValue={today} /></label>
          <label className="f wide">Заклучоци<textarea name="note" rows={2} defaultValue={O.self?.note ?? ''} style={{ width: '100%', font: 'inherit' }} /></label>
          <label className="f wide">Мерки за намалување на ризикот<textarea name="measures" rows={2} defaultValue={O.self?.measures ?? ''} style={{ width: '100%', font: 'inherit' }} /></label>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}><button className="btn pri">Зачувај проценка</button><a className="btn" href="/amlDoc?d=self" target="_blank" rel="noopener">🖨 Проценка (PDF)</a></div>
        <p className="mini" style={{ margin: '4px 0 0' }}>Законот бара „редовно“ ажурирање и нова проценка пред значајни промени, нови услуги или технологии; програмата предвидува најмалку еднаш годишно. Се доставува на барање на УФР.</p>
      </ActionForm>

      <ActionForm action={amlTrAdd}>
        <H2>Обуки (најмалку 2 годишно, чл. 12) · во {y}: {tr.length}</H2>
        <div className="form">
          <label className="f">Датум<input name="date" type="date" /></label>
          <label className="f wide">Тема<input name="topic" placeholder="пр. Индикатори за сомнителни трансакции; нови листи на УФР" /></label>
          <label className="f wide">Учесници<input name="who" /></label>
        </div>
        <button className="btn sm" style={{ marginTop: 6 }}>+ Евидентирај обука</button>
        {(O.tr ?? []).length > 0 && <table className="dense" style={{ marginTop: 6 }}><tbody>{[...(O.tr ?? [])].reverse().map((t, i) => <tr key={i}><td>{dmy(t.date)}</td><td>{t.topic}</td><td>{t.who ?? ''}</td></tr>)}</tbody></table>}
      </ActionForm>

      <ActionForm action={amlConfAdd}>
        <H2>Изјави за доверливост на вработените (чл. 72 ст.3)</H2>
        <div className="form">
          <label className="f">Вработен<select name="name"><option value="">—</option>{U.filter((x) => x.role !== 'klient' && x.active).map((x) => <option key={x.id}>{x.name}</option>)}</select></label>
          <label className="f">Потпишана на<input name="date" type="date" defaultValue={today} /></label>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}><button className="btn sm">+ Евидентирај</button><a className="btn sm" href="/amlDoc?d=conf" target="_blank" rel="noopener">🖨 Образец на изјава</a></div>
        {(O.conf ?? []).length > 0 && <p className="mini" style={{ margin: '6px 0 0' }}>{(O.conf ?? []).map((c) => `${c.name} (${dmy(c.date)})`).join(' · ')}</p>}
      </ActionForm>

      <ActionForm action={amlCtlSave}>
        <H2>Внатрешна контрола (чл. 69 – најмалку еднаш годишно, во тековната за претходната година)</H2>
        <p style={{ margin: '0 0 6px' }}>Последна: <b>{O.ctl ? dmy(O.ctl) : '—'}</b></p>
        <div className="form">
          <label className="f">Датум<input name="date" type="date" defaultValue={today} /></label>
          <label className="f">За година<input name="period" defaultValue={String(Number(y) - 1)} /></label>
          <label className="f">Извршил<input name="by" /></label>
          <label className="f wide">Наоди<textarea name="findings" rows={3} style={{ width: '100%', font: 'inherit' }} placeholder="Проверени досиеја на клиенти, рокови за прегледи, внатрешни пријави, извештаи до УФР, обуки…" /></label>
          <label className="f wide">Мерки<textarea name="measures" rows={2} style={{ width: '100%', font: 'inherit' }} /></label>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}><button className="btn pri">Евидентирај контрола</button><a className="btn" href="/amlDoc?d=ctl" target="_blank" rel="noopener">🖨 Годишен извештај (PDF)</a></div>
      </ActionForm>

      <ActionForm action={amlHrcSet} reset={false}>
        <H2>Мониторинг: високоризични земји и поделена готовина</H2>
        <div className="form">
          <label className="f wide">Високоризични трети земји (ISO код или назив, по ред){O.hrcDate ? ` – ажурирано ${dmy(O.hrcDate)}` : ' – ⚠ не е проверена'}<textarea name="hrc" rows={4} defaultValue={(O.hrc ?? AML_HRC_DEFAULT).join('\n')} style={{ width: '100%', font: 'inherit' }} /></label>
          <label className="f">Прозорец за „поделена готовина“ (денови)<input name="linkDays" type="number" min={1} max={366} defaultValue={O.linkDays ?? AML_SPLIT_DAYS} /></label>
        </div>
        <button className="btn sm" style={{ marginTop: 6 }}>Зачувај</button>
        <p className="mini" style={{ margin: '4px 0 0' }}>УФР ја објавува листата најмалку двапати годишно (чл. 43 ст.4) – <a href="https://ufr.gov.mk/?page_id=3315" target="_blank" rel="noopener">високоризични земји</a>. Корисни линкови: <a href="https://ufr.gov.mk/?page_id=206" target="_blank" rel="noopener">индикатори (УФР)</a> · <a href="https://ufr.gov.mk/?page_id=204" target="_blank" rel="noopener">упатства на УФР</a> · <a href={UFR_APP} target="_blank" rel="noopener">Доставување на извештаи до УФР</a></p>
      </ActionForm>
    </>
  );
}
