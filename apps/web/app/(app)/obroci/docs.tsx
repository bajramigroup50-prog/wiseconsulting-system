/**
 * Printed documents of „🍲 Корисници и оброци“ under the Закон за заштита на личните податоци (ЗЗЛП):
 * - `ConsentDoc` — the bilingual (македонски / shqip) consent of a beneficiary for processing personal data, health and
 *   social data included (a special category: explicit consent);
 * - `ProcessingRecords` — „Евиденција на активностите за обработка на лични податоци“ of the association, pre-filled
 *   with the firm data.
 */
import type { Firm, MealBeneficiaryRow } from '@wise/db';
import { CONSENT_KEEP_YEARS } from '@wise/core/npo';
import { dmy } from '@/lib/fmt';

const LAW = 'Законот за заштита на личните податоци („Службен весник на РСМ“ бр. 42/20)';
const LAW_SQ = 'Ligjit për mbrojtjen e të dhënave personale („Gazeta Zyrtare e RMV“ nr. 42/20)';

type Signer = { signer?: string; signerRole?: string };
const signerOf = (firm: Firm) => (firm.settings ?? {}) as Signer;
const addr = (firm: Firm) => [firm.address, firm.city].filter(Boolean).join(', ');
const line = (v: string | null | undefined, w = 60) => v || <span style={{ display: 'inline-block', minWidth: `${w}mm`, borderBottom: '1px dotted #000' }}>&nbsp;</span>;

function Two({ mk, sq }: { mk: React.ReactNode; sq: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6mm', breakInside: 'avoid', margin: '2mm 0' }}>
      <div>{mk}</div>
      <div style={{ fontStyle: 'italic' }}>{sq}</div>
    </div>
  );
}

/** One beneficiary's consent (A4, both languages side by side). */
export function ConsentDoc({ b, firm }: { b: Pick<MealBeneficiaryRow, 'name' | 'embg' | 'place' | 'phone' | 'members' | 'consentDate'>; firm: Firm }) {
  const S = signerOf(firm);
  return (
    <div style={{ fontSize: '9.5pt', lineHeight: 1.4 }}>
      <h2 style={{ textAlign: 'center', margin: '0 0 1mm', fontSize: '13pt' }}>СОГЛАСНОСТ ЗА ОБРАБОТКА НА ЛИЧНИ ПОДАТОЦИ</h2>
      <h3 style={{ textAlign: 'center', margin: '0 0 4mm', fontSize: '11pt', fontStyle: 'italic' }}>PËLQIM PËR PËRPUNIMIN E TË DHËNAVE PERSONALE</h3>
      <Two
        mk={<><b>Контролор:</b> {firm.name}, {addr(firm)}, ЕДБ {firm.edb ?? ''}{firm.email ? `, е-пошта ${firm.email}` : ''}{firm.phone ? `, тел. ${firm.phone}` : ''} (во понатамошниот текст: Здружението).</>}
        sq={<><b>Kontrolluesi:</b> {firm.name}, {addr(firm)}, NUMRI TATIMOR {firm.edb ?? ''}{firm.email ? `, e-mail ${firm.email}` : ''}{firm.phone ? `, tel. ${firm.phone}` : ''} (në tekstin e mëtejmë: Shoqata).</>}
      />
      <table className="dense" style={{ width: '100%', margin: '2mm 0 3mm' }}>
        <tbody>
          <tr><td style={{ width: '45%' }}>Име и презиме (носител на семејството) / <i>Emri dhe mbiemri (bartësi i familjes)</i></td><td><b>{b.name}</b></td></tr>
          <tr><td>ЕМБГ / <i>NUAM</i></td><td>{line(b.embg, 50)}</td></tr>
          <tr><td>Адреса / место / <i>Adresa / vendbanimi</i></td><td>{line(b.place, 70)}</td></tr>
          <tr><td>Телефон / <i>Telefoni</i></td><td>{line(b.phone, 40)}</td></tr>
          <tr><td>Број на членови на семејството / <i>Numri i anëtarëve të familjes</i></td><td>{b.members}</td></tr>
        </tbody>
      </table>
      <Two
        mk={<><b>1. Цел.</b> Податоците се обработуваат единствено за давање хуманитарна помош – оброци во народната кујна на Здружението, за водење евиденција на корисниците и оброците, и за збирно известување на донаторите и на надлежните органи (без имиња на корисниците).</>}
        sq={<><b>1. Qëllimi.</b> Të dhënat përpunohen vetëm për dhënien e ndihmës humanitare – racione ushqimi në kuzhinën popullore të Shoqatës, për evidencën e përfituesve dhe të racioneve, dhe për raportimin përmbledhës te donatorët dhe te organet kompetente (pa emrat e përfituesve).</>}
      />
      <Two
        mk={<><b>2. Податоци.</b> Име и презиме, ЕМБГ, адреса, телефон, број и имиња на членовите на семејството, националност, како и податоци за <b>социјалната и здравствената состојба</b> на семејството – тоа се <b>посебни категории лични податоци</b> според {LAW} и се обработуваат само врз основа на оваа изречна согласност.</>}
        sq={<><b>2. Të dhënat.</b> Emri dhe mbiemri, NUAM, adresa, telefoni, numri dhe emrat e anëtarëve të familjes, kombësia, si dhe të dhëna për <b>gjendjen sociale dhe shëndetësore</b> të familjes – këto janë <b>kategori të veçanta të të dhënave personale</b> sipas {LAW_SQ} dhe përpunohen vetëm në bazë të këtij pëlqimi të shprehur.</>}
      />
      <Two
        mk={<><b>3. Кој ги гледа.</b> Само овластените лица на Здружението што ја водат листата на корисници и сметководствената канцеларија што ги води книгите на Здружението (како обработувач, со договор за обработка). Државните органи ги добиваат само кога тоа го бара закон. Податоците не се објавуваат и не им се даваат поименично на донаторите. Се чуваат во заштитена програма (лозинка, евиденција на секоја промена) и во заклучен орман.</>}
        sq={<><b>3. Kush i sheh.</b> Vetëm personat e autorizuar të Shoqatës që e mbajnë listën e përfituesve dhe zyra e kontabilitetit që i mban librat e Shoqatës (si përpunues, me marrëveshje për përpunim). Organet shtetërore i marrin vetëm kur këtë e kërkon ligji. Të dhënat nuk publikohen dhe nuk u jepen donatorëve me emra. Ruhen në program të mbrojtur (fjalëkalim, evidencë e çdo ndryshimi) dhe në dollap të mbyllur.</>}
      />
      <Two
        mk={<><b>4. Рок на чување.</b> Додека семејството прима помош и уште {CONSENT_KEEP_YEARS} години по последниот оброк (заради отчет кон донаторите и контрола); потоа податоците се бришат, а хартиените документи се уништуваат.</>}
        sq={<><b>4. Afati i ruajtjes.</b> Përderisa familja merr ndihmë dhe edhe {CONSENT_KEEP_YEARS} vjet pas racionit të fundit (për raportim te donatorët dhe kontroll); pastaj të dhënat fshihen, ndërsa dokumentet në letër asgjësohen.</>}
      />
      <Two
        mk={<><b>5. Права.</b> Имате право на пристап до своите податоци, исправка, бришење, ограничување на обработката и приговор, како и да ја <b>повлечете согласноста во секое време</b> (писмено до Здружението), без тоа да влијае на обработката пред повлекувањето. Имате право на барање до Агенцијата за заштита на личните податоци (azlp.mk). Согласноста е доброволна.</>}
        sq={<><b>5. Të drejtat.</b> Keni të drejtë qasjeje në të dhënat tuaja, korrigjimi, fshirjeje, kufizimi të përpunimit dhe kundërshtimi, si dhe ta <b>tërhiqni pëlqimin në çdo kohë</b> (me shkrim te Shoqata), pa ndikuar në përpunimin para tërheqjes. Keni të drejtë kërkese te Agjencia për Mbrojtjen e të Dhënave Personale (azlp.mk). Pëlqimi është vullnetar.</>}
      />
      <Two
        mk={<><b>Изјава.</b> Со потписот потврдувам дека сум информиран/а за горенаведеното и <b>изречно се согласувам</b> Здружението да ги обработува моите лични податоци и податоците на членовите на моето семејство (и за малолетните членови, како родител / старател), вклучувајќи ги податоците за социјалната и здравствената состојба, за целта од точка 1.</>}
        sq={<><b>Deklaratë.</b> Me nënshkrimin konfirmoj se jam informuar për sa më sipër dhe <b>pajtohem shprehimisht</b> që Shoqata t’i përpunojë të dhënat e mia personale dhe të dhënat e anëtarëve të familjes sime (edhe për anëtarët e mitur, si prind / kujdestar), përfshirë të dhënat për gjendjen sociale dhe shëndetësore, për qëllimin nga pika 1.</>}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10mm', breakInside: 'avoid' }}>
        <div>Место и датум / <i>Vendi dhe data</i>:<br />{firm.city ?? ''}, {b.consentDate ? dmy(b.consentDate) : line(null, 30)}</div>
        <div style={{ textAlign: 'center', minWidth: '65mm' }}>Корисник / <i>Përfituesi</i><div style={{ height: '14mm' }} /><div style={{ borderTop: '1px solid #000' }}>потпис / <i>nënshkrimi</i></div></div>
        <div style={{ textAlign: 'center', minWidth: '55mm' }}>За Здружението / <i>Për Shoqatën</i><div>{S.signer ?? ''}</div><div style={{ height: '10mm' }} /><div style={{ borderTop: '1px solid #000' }}>потпис и печат</div></div>
      </div>
    </div>
  );
}

type Act = { name: string; purpose: string; subjects: string; data: string; basis: string; recipients: string; keep: string };

/** Texts of the records of processing in Macedonian (the official one) or Albanian (the screen's language). */
function recText(sq: boolean, counts: { benef: number; members: number; donors?: number }) {
  const acc = sq ? 'zyra e kontabilitetit (përpunues, marrëveshje për përpunim)' : 'сметководствената канцеларија (обработувач, договор за обработка)';
  const A: Act[] = sq ? [
    {
      name: `Përfituesit e kuzhinës popullore (${counts.benef} familje / persona)`,
      purpose: 'Ndihmë humanitare – racione; evidenca e përfituesve dhe e racioneve; raporte përmbledhëse për donatorët dhe organet',
      subjects: 'Përfituesit (bartësit e familjeve) dhe anëtarët e familjeve të tyre, përfshirë të miturit',
      data: 'Emri dhe mbiemri, NUAM, adresa, telefoni, numri i anëtarëve, kombësia; KATEGORI E VEÇANTË: gjendja sociale dhe shëndetësore',
      basis: 'Pëlqimi i shprehur me shkrim i përfituesit (formulari „Pëlqim për përpunimin e të dhënave personale“)',
      recipients: `Personat e autorizuar të shoqatës; ${acc}; organet shtetërore vetëm sipas ligjit`,
      keep: `Gjatë ndihmës + ${CONSENT_KEEP_YEARS} vjet pas racionit të fundit`,
    },
    {
      name: `Anëtarët e shoqatës dhe të organeve (${counts.members})`,
      purpose: 'Regjistri i anëtarëve dhe i anëtarëve të organeve; thirrja e kuvendit; anëtarësia',
      subjects: 'Anëtarët, anëtarët e kuvendit, të bordit drejtues / mbikëqyrës, kryetari',
      data: 'Emri dhe mbiemri, NUAM (opsionale), adresa, telefoni, e-mail, data e anëtarësimit / largimit, organi dhe funksioni',
      basis: 'Detyrim ligjor (Ligji për shoqatat dhe fondacionet) dhe statuti i shoqatës',
      recipients: `Organet e shoqatës; ${acc}; Regjistri Qendror dhe organe të tjera sipas ligjit`,
      keep: 'Përderisa është anëtar dhe 5 vjet pas largimit; procesverbalet – përgjithmonë',
    },
    {
      name: `Donatorët dhe sponsorët${counts.donors ? ` (${counts.donors})` : ''}`,
      purpose: 'Kontrata donacioni, vërtetime për donacion të pranuar, raporti UJP-IDS/PR, kontabilizimi',
      subjects: 'Donatorët – persona fizikë dhe personat përgjegjës të personave juridikë',
      data: 'Emri dhe mbiemri / emërtimi, NUAM / numri tatimor, adresa, telefoni, e-mail, llogaria, shuma / vlera',
      basis: 'Kontratë dhe detyrim ligjor (Ligji për donacionet dhe sponsorizimet në veprimtaritë publike, rregullat tatimore)',
      recipients: `${acc}; Drejtoria e të Ardhurave Publike; banka`,
      keep: 'Sipas afateve të rregullave për kontabilitet dhe tatime',
    },
    {
      name: 'Vullnetarët dhe të punësuarit (nëse ka)',
      purpose: 'Angazhimi, evidenca e punës, pagat dhe kontributet',
      subjects: 'Vullnetarët, të punësuarit',
      data: 'Emri dhe mbiemri, NUAM, adresa, telefoni, llogaria, orari i punës',
      basis: 'Kontratë dhe detyrim ligjor (marrëdhëniet e punës, vullnetarizmi, tatimet)',
      recipients: `${acc}; DAP, FPSM, FSSHM, Agjencia e Punësimit`,
      keep: 'Sipas afateve të rregullave për marrëdhëniet e punës dhe kontabilitetin',
    },
  ] : [
    {
      name: `Корисници на народната кујна (${counts.benef} семејства / лица)`,
      purpose: 'Хуманитарна помош – оброци; евиденција на корисниците и оброците; збирни извештаи за донаторите и органите',
      subjects: 'Корисници (носители на семејства) и членовите на нивните семејства, вклучително малолетни',
      data: 'Име и презиме, ЕМБГ, адреса, телефон, број на членови, националност; ПОСЕБНА КАТЕГОРИЈА: социјална и здравствена состојба',
      basis: 'Изречна писмена согласност на корисникот (образец „Согласност за обработка на лични податоци“)',
      recipients: `Овластени лица на здружението; ${acc}; државни органи само по закон`,
      keep: `Додека трае помошта + ${CONSENT_KEEP_YEARS} години по последниот оброк`,
    },
    {
      name: `Членови на здружението и на органите (${counts.members})`,
      purpose: 'Регистар на членови и на членовите на органите; свикување собрание; членарина',
      subjects: 'Членови, членови на собранието, управниот / надзорниот одбор, претседател',
      data: 'Име и презиме, ЕМБГ (по избор), адреса, телефон, е-пошта, датум на зачленување / исчленување, орган и функција',
      basis: 'Законска обврска (Закон за здруженија и фондации) и статутот на здружението',
      recipients: `Органите на здружението; ${acc}; Централен регистар и други органи по закон`,
      keep: 'Додека е член и 5 години по исчленувањето; записниците – трајно',
    },
    {
      name: `Донатори и спонзори${counts.donors ? ` (${counts.donors})` : ""}`,
      purpose: 'Договори за донации, потврди за примена донација, извештај УЈП-ИДС/ПР, книжење',
      subjects: 'Донатори – физички лица и одговорни лица на правните лица',
      data: 'Име и презиме / назив, ЕМБГ / ЕДБ, адреса, телефон, е-пошта, сметка, износ / вредност',
      basis: 'Договор и законска обврска (Закон за донации и спонзорства во јавните дејности, даночни прописи)',
      recipients: `${acc}; Управа за јавни приходи; банка`,
      keep: 'Според роковите на прописите за сметководство и даноци',
    },
    {
      name: 'Волонтери и вработени (ако има)',
      purpose: 'Ангажман, евиденција на работа, плати и придонеси',
      subjects: 'Волонтери, вработени',
      data: 'Име и презиме, ЕМБГ, адреса, телефон, сметка, работно време',
      basis: 'Договор и законска обврска (работни односи, волонтерство, даноци)',
      recipients: `${acc}; УЈП, ФПИОМ, ФЗОМ, Агенција за вработување`,
      keep: 'Според роковите на прописите за работни односи и сметководство',
    },
  ];
  const L = sq ? {
    title: 'EVIDENCA E AKTIVITETEVE TË PËRPUNIMIT TË TË DHËNAVE PERSONALE', by: `sipas ${LAW_SQ}`, ctrl: 'Kontrolluesi', seat: 'Selia / numri tatimor', tax: 'NUMRI TATIMOR', reg: 'NJAR',
    contact: 'Kontakti', resp: 'Personi përgjegjës', dpo: 'Oficeri për mbrojtjen e të dhënave personale',
    head: ['Përmbledhja / aktiviteti', 'Qëllimi', 'Subjektet', 'Kategoritë e të dhënave', 'Baza ligjore', 'Marrësit', 'Afati i ruajtjes'],
    transferB: 'Transferimi në vende të treta:', transfer: 'nuk ka.', measuresB: 'Masat teknike dhe organizative:',
    measures: 'të dhënat janë në programin WISE (qasje vetëm me emër përdoruesi dhe fjalëkalim, verifikim me dy faktorë, evidencë e çdo ndryshimi, kopje rezervë ditore); pëlqimet në letër ruhen në dollap të mbyllur; qasje kanë vetëm personat e autorizuar; të dhënat nuk publikohen dhe nuk u jepen donatorëve me emra; pas skadimit të afatit fshihen / asgjësohen me procesverbal.',
    sign: 'nënshkrimi dhe vula',
  } : {
    title: 'ЕВИДЕНЦИЈА НА АКТИВНОСТИТЕ ЗА ОБРАБОТКА НА ЛИЧНИ ПОДАТОЦИ', by: `според ${LAW}`, ctrl: 'Контролор', seat: 'Седиште / ЕДБ', tax: 'ЕДБ', reg: 'ЕМБС',
    contact: 'Контакт', resp: 'Одговорно лице', dpo: 'Офицер за заштита на лични податоци',
    head: ['Збирка / активност', 'Цел', 'Субјекти', 'Категории податоци', 'Правен основ', 'Примачи', 'Рок на чување'],
    transferB: 'Пренос во трети земји:', transfer: 'нема.', measuresB: 'Технички и организациски мерки:',
    measures: 'податоците се во програмата WISE (пристап само со корисничко име и лозинка, двофакторска проверка, евиденција на секоја промена, дневна резервна копија); хартиените согласности се чуваат во заклучен орман; пристап имаат само овластените лица; податоците не се објавуваат и не се даваат поименично на донаторите; по истекот на рокот се бришат / уништуваат со записник.',
    sign: 'потпис и печат',
  };
  return { A, L };
}

/** „Евиденција на активностите за обработка“ of the association (A4 landscape), in the screen's language. */
export function ProcessingRecords({ firm, today, counts, lang = 'mk' }: { firm: Firm; today: string; counts: { benef: number; members: number; donors?: number }; lang?: 'mk' | 'sq' }) {
  const S = signerOf(firm);
  const { A, L } = recText(lang === 'sq', counts);
  return (
    <div style={{ fontSize: '9pt', lineHeight: 1.35 }}>
      <h2 style={{ textAlign: 'center', margin: '0 0 2mm' }}>{L.title}</h2>
      <p style={{ textAlign: 'center', margin: '0 0 4mm' }}>{L.by}</p>
      <table className="dense" style={{ width: '100%', marginBottom: '3mm' }}>
        <tbody>
          <tr><td style={{ width: '28%' }}>{L.ctrl}</td><td><b>{firm.name}</b></td></tr>
          <tr><td>{L.seat}</td><td>{addr(firm)} · {L.tax} {firm.edb ?? ''}{firm.embs ? ` · ${L.reg} ${firm.embs}` : ''}</td></tr>
          <tr><td>{L.contact}</td><td>{[firm.email, firm.phone].filter(Boolean).join(' · ') || line(null)}</td></tr>
          <tr><td>{L.resp}</td><td>{S.signer ?? line(null)}{S.signerRole ? ` (${S.signerRole})` : ''}</td></tr>
          <tr><td>{L.dpo}</td><td>{line(null)}</td></tr>
        </tbody>
      </table>
      <div><table className="dense" style={{ width: '100%' }}>
        <thead><tr>{L.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{A.map((a) => <tr key={a.name}><td><b>{a.name}</b></td><td>{a.purpose}</td><td>{a.subjects}</td><td>{a.data}</td><td>{a.basis}</td><td>{a.recipients}</td><td>{a.keep}</td></tr>)}</tbody>
      </table></div>
      <p style={{ margin: '3mm 0 1mm' }}><b>{L.transferB}</b> {L.transfer} <b>{L.measuresB}</b> {L.measures}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10mm' }}>
        <div>{firm.city ?? ''}, {dmy(today)}</div>
        <div style={{ textAlign: 'center', minWidth: '65mm' }}>{L.resp}<div>{S.signer ?? ''}</div><div style={{ height: '12mm' }} /><div style={{ borderTop: '1px solid #000' }}>{L.sign}</div></div>
      </div>
    </div>
  );
}
