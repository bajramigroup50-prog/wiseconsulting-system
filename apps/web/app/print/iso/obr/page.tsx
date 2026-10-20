/**
 * The forms (ОБР) of the system for print – blank for paper records, or filled from the program: ОБР-01 working time
 * (per colleague, `?m=YYYY-MM`), ОБР-02 training attendance, ОБР-03 assets handover, ОБР-04 handover to the archive
 * (`?id=` a „Предавање во архива“ record), ОБР-05 archive book, ОБР-06 / ОБР-07 the list for destruction and the
 * destruction record (`?id=` an „Излачување“ record), ОБР-10 access review (with the users), ОБР-11 log review (with
 * the numbers of the last 30 days), ОБР-12 the list of categories for the State Archive, `REG` the master register.
 * Every page: „ОБР-05 · в.1.0 · стр. 1/2“.
 */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { can } from '@wise/core';
import { ARCH_CATEGORIES, ARCH_GROUPS, archKeepLabel } from '@wise/core/office/archive';
import { isoNo } from '@wise/core/office/iso';
import { isoForm } from '@wise/core/office/iso-docs';
import { REG_STATE, REG_STD_ORDER, REG_STDS } from '@wise/core/office/iso-registry';
import { employees, getOfficeProfile, isoEvidence } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { viewAllowed } from '@/lib/nav';
import { today } from '@/lib/office';
import { loadIsoRows, loadRegistry, loadStaff, officeFirm } from '../../../(app)/iso/iso-data';
import { docPageCss } from '../page-css';

export const metadata = { title: 'Образец' };

const cell = { border: '1px solid #888', padding: '2px 4px', verticalAlign: 'top' } as const;
const T = ({ head, rows, blank = 0, w }: { head: string[]; rows?: React.ReactNode[][]; blank?: number; w?: (string | undefined)[] }) => (
  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
    <thead><tr>{head.map((h, i) => <th key={i} style={{ ...cell, width: w?.[i], background: '#f2f2f2' }}>{h}</th>)}</tr></thead>
    <tbody>
      {(rows ?? []).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={cell}>{c}</td>)}</tr>)}
      {Array.from({ length: blank }, (_, i) => <tr key={`b${i}`}>{head.map((_, j) => <td key={j} style={{ ...cell, height: '7mm' }} />)}</tr>)}
    </tbody>
  </table>
);
const Sig = ({ L }: { L: string[] }) => (
  <table style={{ width: '100%', marginTop: '12mm', fontSize: '10pt' }}><tbody><tr>{L.map((t) => <td key={t} style={{ textAlign: 'center', width: `${100 / L.length}%` }}>{t}<div style={{ borderTop: '1px solid #111', margin: '12mm 8mm 0' }} /></td>)}</tr></tbody></table>
);
const Line = ({ l, v }: { l: string; v?: string }) => <p style={{ margin: '1mm 0' }}>{l}: {v ? <b>{v}</b> : '______________________________'}</p>;
const WD = ['нед', 'пон', 'вто', 'сре', 'чет', 'пет', 'саб'];

export default async function PrintIsoForm({ searchParams }: { searchParams: Promise<{ f?: string; id?: string; m?: string }> }) {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'iso') || !can(u.principal, 'office', null)) notFound();
  const sp = await searchParams;
  const code = sp.f ?? '';
  const F = isoForm(code);
  if (!F && code !== 'REG') notFound();
  const [O, R] = await Promise.all([getOfficeProfile(db()), loadIsoRows()]);
  const office = O.name ?? '';
  const td = today(), year = Number(td.slice(0, 4));
  const rec = sp.id ? R.find((r) => r.id === sp.id) : undefined;
  const mark = F ? `${F.code} · в.${F.v}` : 'Регистар на задолжителни евиденции';
  const H = ({ t, sub }: { t: string; sub?: string }) => (
    <div style={{ marginBottom: '4mm' }}>
      <div style={{ fontSize: '9pt' }}>{office}</div>
      <div style={{ fontSize: '14pt', fontWeight: 700, textAlign: 'center', marginTop: '3mm' }}>{t}</div>
      {sub && <div style={{ fontSize: '9pt', textAlign: 'center' }}>{sub}</div>}
    </div>
  );
  let body: React.ReactNode;
  let landscape = false;

  if (code === 'REG') {
    landscape = true;
    const staff = await loadStaff(R, td);
    const L = await loadRegistry(R, staff.lines, year, td);
    body = <><H t="РЕГИСТАР НА ЗАДОЛЖИТЕЛНИ ЕВИДЕНЦИИ И ДОКУМЕНТИ" sub={`ISO 9001 §7.5 · состојба на ${dmy(td)}`} />
      {REG_STD_ORDER.map((s) => <div key={s} style={{ marginBottom: '3mm' }}><b>{REG_STDS[s]}</b>
        <T head={['Ознака', 'Евиденција / документ', 'Основ', 'Одговорен', 'Каде се чува', 'Арх. знак · рок', 'Последно', 'Состојба']} w={['8%', '22%', '16%', '10%', '16%', '10%', '7%', '11%']}
          rows={L.filter((r) => r.std === s).map((r) => [r.code, r.n, r.basis, r.owner, r.where, `${r.sign} · ${r.retention}`, r.last ? dmy(r.last) : '', `${REG_STATE[r.state][0]} ${r.note}`])} /></div>)}</>;
  } else if (code === 'ОБР-01') {
    const m = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : td.slice(0, 7);
    const [y, mo] = m.split('-').map(Number) as [number, number];
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const off = await officeFirm();
    const E = off ? (await db().select({ name: employees.name, position: employees.position, active: employees.active }).from(employees).where(eq(employees.firmId, off.id))).filter((e) => e.active) : [];
    const people = E.length ? E : [{ name: '', position: '' }];
    body = people.map((e, i) => (
      <div key={i} style={i ? { breakBefore: 'page', pageBreakBefore: 'always' } : undefined}>
        <H t="ЕВИДЕНЦИЈА НА РАБОТНО ВРЕМЕ" sub="Закон за евиденции во областа на трудот" />
        <Line l="Работник" v={e.name || undefined} /><Line l="Работно место" v={e.position || undefined} /><Line l="Месец" v={`${String(mo).padStart(2, '0')}.${y}`} />
        <T head={['Ден', 'Дојден', 'Заминат', 'Часови', 'Прекувремено', 'Отсуство (вид)', 'Потпис']} w={['12%', '12%', '12%', '10%', '12%', '22%', '20%']}
          rows={Array.from({ length: days }, (_, d) => { const dt = new Date(Date.UTC(y, mo - 1, d + 1)); const we = dt.getUTCDay() % 6 === 0; return [`${d + 1}. ${WD[dt.getUTCDay()]}`, we ? '—' : '', we ? '—' : '', '', '', '', '']; })} />
        <p style={{ fontSize: '9pt' }}>Вкупно часови: ________ · Прекувремено: ________ · Годишен одмор: ____ · Боледување: ____ · Друго отсуство: ____</p>
        <Sig L={['Работник', 'Одговорно лице']} />
      </div>
    ));
  } else if (code === 'ОБР-02') {
    body = <><H t="ЛИСТА НА ПРИСУТНИ НА ОБУКА" sub="ISO 9001 §7.2 · ISO/IEC 27001 A.6.3 · Закон за безбедност и здравје при работа" />
      <Line l="Тема" /><Line l="Датум и траење (часови)" /><Line l="Предавач / организатор" />
      <T head={['Р.бр.', 'Име и презиме', 'Работно место', 'Потпис']} w={['8%', '40%', '27%', '25%']} rows={[]} blank={15} />
      <p style={{ fontSize: '9pt' }}>Оценка на ефективноста на обуката (што се промени во работата): ____________________________________________</p>
      <Sig L={['Предавач', 'Одговорно лице']} /></>;
  } else if (code === 'ОБР-03') {
    body = <><H t="РЕВЕРС – ЗАДОЛЖУВАЊЕ И ВРАЌАЊЕ НА СРЕДСТВА" sub="ISO/IEC 27001 A.5.9–A.5.11 · Политика за прифатлива употреба (ПОЛ-06)" />
      <Line l="Вработен" />
      <T head={['Р.бр.', 'Средство', 'Сериски број / ознака', 'Задолжено на', 'Потпис', 'Вратено на', 'Потпис']} w={['6%', '24%', '20%', '11%', '14%', '11%', '14%']} rows={[]} blank={10} />
      <p style={{ fontSize: '9pt' }}>Со потписот вработениот потврдува дека средствата ги примил исправни, дека ќе ги користи според Политиката за прифатлива употреба и дека ќе ги врати при престанок на работата, без да задржи копии од податоците.</p>
      <Sig L={['Вработен', 'Одговорно лице']} /></>;
  } else if (code === 'ОБР-04') {
    const d = rec?.kind === 'archhand' ? rec.data : {};
    body = <><H t="ЗАПИСНИК ЗА ПРЕДАВАЊЕ НА ДОКУМЕНТАРЕН МАТЕРИЈАЛ ВО АРХИВА" sub="Уредба за канцелариско и архивско работење" />
      {rec && <p style={{ fontSize: '9pt' }}>{isoNo(rec.kind, rec.no, rec.year)}</p>}
      <Line l="Датум на предавање" v={d.date ? dmy(String(d.date)) : undefined} /><Line l="Материјал од годината" v={d.year ? String(d.year) : undefined} />
      <Line l="Предава (организациска единица / лице)" v={d.handedBy ? String(d.handedBy) : undefined} /><Line l="Прима (архива)" v={d.receivedBy ? String(d.receivedBy) : undefined} />
      <T head={['Р.бр.', 'Архивски знак', 'Содржина', 'Години', 'Количина (кутии / регистратори)']} w={['7%', '13%', '45%', '15%', '20%']}
        rows={String(d.items ?? '').split('\n').filter((x) => x.trim()).map((x, i) => [String(i + 1), '', x, '', ''])} blank={d.items ? 3 : 12} />
      <p>Вкупно: {d.qty ? <b>{String(d.qty)}</b> : '____________'}. Материјалот е среден, пописан и запишан во архивската книга (ОБР-05).</p>
      <Sig L={['Предал', 'Примил']} /></>;
  } else if (code === 'ОБР-05') {
    landscape = true;
    const B = R.filter((r) => r.kind === 'archbook').sort((a, b) => a.year - b.year || a.no - b.no);
    body = <><H t="АРХИВСКА КНИГА" sub="Закон за архивски материјал и документарен материјал" />
      <T head={['Р.бр.', 'Датум', 'Архивски знак', 'Содржина', 'Години', 'Количина', 'Носач', 'Рок на чување', 'Каде се чува', 'Забелешка']} w={['5%', '8%', '8%', '25%', '8%', '9%', '8%', '9%', '10%', '10%']}
        rows={B.map((r, i) => { const sign = String(r.data.sign ?? '').slice(0, 5); const c = ARCH_CATEGORIES.find((x) => x.sign === sign); return [String(i + 1), r.data.date ? dmy(String(r.data.date)) : '', sign, String(r.data.content ?? r.title), String(r.data.years ?? ''), String(r.data.qty ?? ''), String(r.data.medium ?? ''), c ? archKeepLabel(c) : '', String(r.data.location ?? ''), String(r.data.note ?? '')]; })} blank={B.length ? 5 : 20} /></>;
  } else if (code === 'ОБР-06' || code === 'ОБР-07') {
    const d = rec?.kind === 'archdestroy' ? rec.data : {};
    const items = String(d.items ?? '').split('\n').filter((x) => x.trim());
    body = code === 'ОБР-06'
      ? <><H t="ПОПИС НА ДОКУМЕНТАРЕН МАТЕРИЈАЛ ПРЕДЛОЖЕН ЗА ИЗЛАЧУВАЊЕ" sub="Закон за архивски материјал – материјал со истечен рок на чување" />
        <Line l="Датум на пописот" v={d.listDate ? dmy(String(d.listDate)) : undefined} /><Line l="Комисија" v={d.commission ? String(d.commission) : undefined} />
        <T head={['Р.бр.', 'Архивски знак', 'Содржина', 'Години', 'Количина', 'Рок на чување', 'Рокот истекол на']} w={['6%', '11%', '35%', '11%', '11%', '13%', '13%']}
          rows={items.map((x, i) => [String(i + 1), '', x, '', '', '', ''])} blank={items.length ? 3 : 15} />
        <p style={{ fontSize: '9pt' }}>Материјалот означен „трајно“ не се излачува. Пописот се доставува до Државниот архив за согласност; без согласност материјалот не се уништува.</p>
        <Sig L={['Претседател на комисијата', 'Член', 'Член']} /></>
      : <><H t="ЗАПИСНИК ЗА УНИШТУВАЊЕ НА ДОКУМЕНТАРЕН МАТЕРИЈАЛ И НОСАЧИ НА ПОДАТОЦИ" sub="Закон за архивски материјал · Закон за заштита на личните податоци" />
        <Line l="Датум и место на уништувањето" v={d.destroyedOn ? dmy(String(d.destroyedOn)) : undefined} /><Line l="Согласност од Државниот архив (број и датум)" v={d.archiveApproval ? String(d.archiveApproval) : undefined} />
        <Line l="Комисија" v={d.commission ? String(d.commission) : undefined} /><Line l="Начин на уништување" v={d.method ? String(d.method) : undefined} /><Line l="Присутни" v={d.witness ? String(d.witness) : undefined} />
        <T head={['Р.бр.', 'Архивски знак', 'Содржина / носач на податоци', 'Години', 'Количина']} w={['7%', '13%', '50%', '15%', '15%']} rows={items.map((x, i) => [String(i + 1), '', x, '', ''])} blank={items.length ? 3 : 12} />
        <p style={{ fontSize: '9pt' }}>Комисијата потврдува дека наведениот материјал е уништен на начин што оневозможува читање и повторно користење на податоците (вклучително и личните податоци); електронските носачи се избришани / физички уништени.</p>
        <Sig L={['Претседател на комисијата', 'Член', 'Член']} /></>;
  } else if (code === 'ОБР-10') {
    const ev = await db().transaction((tx) => isoEvidence(tx, new Date(Date.now() - 30 * 864e5)));
    body = <><H t="ЗАПИСНИК ОД ПРЕГЛЕД НА ПРАВАТА НА ПРИСТАП" sub="ISO/IEC 27001 A.5.15–A.5.18 · двапати годишно" />
      <Line l="Датум на прегледот" /><Line l="Прегледал" />
      <T head={['Корисник', 'Корисничко име', 'Улога', 'Статус', 'Потребен пристап? (да / не)', 'Промена']} w={['22%', '16%', '12%', '10%', '18%', '22%']}
        rows={ev.users.map((x) => [x.name, x.username, x.role, x.active ? 'активен' : 'затворен', '', ''])} blank={2} />
      <p style={{ fontSize: '9pt' }}>Проверено: корисници на заминати вработени затворени □ · улоги според работата (најмала потребна) □ · заеднички сметки и лозинки сменети при промена □</p>
      <Sig L={['Прегледал', 'Управител']} /></>;
  } else if (code === 'ОБР-11') {
    const ev = await db().transaction((tx) => isoEvidence(tx, new Date(Date.now() - 30 * 864e5)));
    body = <><H t="ЗАПИСНИК ОД ПРЕГЛЕД НА ДНЕВНИКОТ (ЛОГОВИ)" sub="ISO/IEC 27001 A.8.15–A.8.16 · месечно" />
      <Line l="Период" v={`${dmy(new Date(Date.now() - 30 * 864e5).toISOString())} – ${dmy(td)}`} /><Line l="Прегледал" />
      <T head={['Проверка', 'Состојба од програмата', 'Наод / мерка']} w={['40%', '25%', '35%']} rows={[
        ['Најавувања (необични часови, непознати корисници)', `${ev.logins} најави`, ''], ['Евидентирани промени', `${ev.changes}`, ''],
        ['Најчести дејства', ev.topActions.slice(0, 4).map((x) => `${x.a} ${x.n}`).join(', '), ''], ['Грешки на системот', `${ev.errors.open} отворени · ${ev.errors.fixed} решени`, ''],
        ['Нови / затворени корисници', `${ev.users.filter((x) => x.active).length} активни`, ''], ['Сомнителни настани → инцидент', '', ''],
      ]} />
      <Sig L={['Прегледал', 'Управител']} /></>;
  } else if (code === 'ОБР-12') {
    body = <><H t="ЛИСТА НА КАТЕГОРИИ НА ДОКУМЕНТАРЕН МАТЕРИЈАЛ СО РОКОВИ НА ЧУВАЊЕ" sub="Закон за архивски материјал и документарен материјал · Уредба за канцелариско и архивско работење" />
      <p style={{ textAlign: 'justify' }}>Врз основа на Законот за архивски материјал и документарен материјал, управителот на {office} ја донесе следната листа. Роковите на чување течат од 1 јануари наредната година по настанувањето на материјалот (кај договорите и АМЛ досиејата – од престанокот на односот). Материјалот со рок „трајно“ е архивски материјал.</p>
      {Object.entries(ARCH_GROUPS).map(([g, n]) => <div key={g} style={{ marginBottom: '2mm' }}><b>{g} {n}</b>
        <T head={['Архивски знак', 'Категорија на документарен материјал', 'Рок на чување', 'Основ']} w={['12%', '50%', '14%', '24%']}
          rows={ARCH_CATEGORIES.filter((c) => c.group === g).map((c) => [c.sign, c.n, archKeepLabel(c), c.basis])} /></div>)}
      <p style={{ marginTop: '6mm' }}>Број и датум: ______________ · Место: ______________</p>
      <Sig L={['Управител', 'Согласност – Државен архив']} /></>;
  }

  return (
    <div className="pdfdoc" style={{ fontFamily: "'Times New Roman',Georgia,serif", fontSize: '10.5pt', lineHeight: 1.4 }}>
      <style dangerouslySetInnerHTML={{ __html: docPageCss(mark, office, landscape) }} />
      {body}
    </div>
  );
}
