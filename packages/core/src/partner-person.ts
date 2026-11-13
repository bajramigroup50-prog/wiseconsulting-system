/**
 * Is a buyer a natural person (граѓанин)? Its receivable goes on 1205 „Побарување од купувачи – граѓани“ instead of
 * 1200 (`customerPerson`, posting.ts). Explicit `data.person` wins; else the tax number: a company's ЕДБ starts with
 * 4 (legal entity) or 5 (sole trader / profession – адвокат, нотар …); an ЕМБГ (13 digits starting with a valid
 * day/month) is a person; without a number, a name of 2–3 words with no company / profession word is a person.
 */
const BIZ_WORD = /(^|[^\p{L}])(доо|дооел|ад|тп|јтд|дпту|дптпу|дпу|дтту|дтпу|ооо|doo|dooel|ad|tp|ltd|llc|gmbh|друштво|компанија|company|банка|banka|bank|фонд|fond|општина|opstina|агенција|agencija|центар|centar|министерство|управа|uprava|трезор|буџет|адвокат|advokat|нотар|notar|извршител|izvrsitel|пзу|pzu|ординација|ordinacija|аптека|апотека|apteka|клиника|klinika|болница|училиште|школа|факултет|универзитет|здружение|фондација|клуб|klub|маркет|market|сервис|servis|трејд|trejd|трговија|продукција|комерц|komerc|интернационал|international|холдинг|групација|груп|group|институт|завод|јавно|претпријатие|станица|канцеларија|бургер|донер|бар|кафе|кафуле|ресторан|пицерија|хотел|мотел|салон|студио|шоп|shop|трафика|пекара|месарница|бутик|фарма|агро|транс|trans|логистик|logistik|стил|инжинеринг|инженеринг|градба|мебел|електро|ауто|auto|моторс|медикал|дент|оптика|кетеринг|туристичка|travel|маркетинг|консалтинг|consulting|солуции|systems|систем)(?![\p{L}])/iu;

const embgDate = (s: string): boolean => {
  const d = Number(s.slice(0, 2)), m = Number(s.slice(2, 4));
  return d >= 1 && d <= 31 && m >= 1 && m <= 12;
};

export function isPersonPartner(p: { name?: string | null; edb?: string | null; data?: Record<string, unknown> | null } | null | undefined): boolean {
  if (!p) return false;
  const flag = p.data?.person;
  if (flag === true || flag === 'true' || flag === '1') return true;
  if (flag === false || flag === 'false' || flag === '0') return false;
  const no = String(p.edb ?? '').replace(/\D/g, '');
  const name = String(p.name ?? '').replace(/[„“”"'.,]/g, ' ').trim();
  if (no.length === 13) return !/^[45]/.test(no) && embgDate(no);
  if (no.length > 0) return false;
  if (!name || BIZ_WORD.test(name)) return false;
  const w = name.split(/\s+/);
  return w.length >= 2 && w.length <= 3 && w.every((x) => /^\p{L}{2,}(-\p{L}{2,})?$/u.test(x));
}
