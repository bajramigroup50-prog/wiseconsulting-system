/**
 * Финансово › „Аналитика“ — the analytic card workflow of the old desktop program, in one screen:
 *  1. Избор на конто за аналитика (period, „Само конта со книжење“, search „2200“, денарска / девизна / денарско-девизна,
 *     ИОС, девизен ИОС, синтетичка картица, промена на период F6, групен избор F7, сортирање Налог / Датум);
 *  2. a partner konto (120–128, 220–228, 1620, 2620, or any konto with partner lines) → its partners: Должи, Побарува,
 *     Салдо, доспеан износ, доцни ден., Салдо ПС, partner data; Активни / Пасивни / Сите;
 *  3. the card „Аналитика“ of the partner (F4 / F5 previous / next partner of the list, групно по изводи, F2 print,
 *     Excel, F3 the nalog of the line, Esc back). A konto without partners opens its card directly.
 * Data: the konto card (`kkart/data.ts` `kkData`), the partner lines (`lib/finance.ts` `finLines`), pure logic `lib/akart.ts`.
 */
import { effectiveChart } from '@wise/db';
import { booksPage, inYearOr } from '@/lib/books';
import { db } from '@/lib/db';
import { todayIso } from '@/lib/fmt';
import { finLines, partnerMap } from '@/lib/finance';
import { aggregatedLines } from '@/lib/ledger-agg';
import { akFilter, akMode, isPartnerKonto, kontoRows, neighbours, partnerRows } from '@/lib/akart';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ExportBar } from '@/components/parity-fin/export-bar';
import { kkData } from '../kkart/data';
import { CardStep, KontoStep, PartnerStep, akHref, cardRows, type AkState } from './views';

type SP = { at?: string; k?: string; pid?: string; from?: string; to?: string; post?: string; sort?: string; m?: string; f?: string; g?: string };

export default async function AkartPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { firm, year } = await booksPage('akart');
  if (!firm) return <NoFirm t="Аналитика" />;
  const post = String(sp.post ?? '');
  const s: AkState = {
    from: inYearOr(sp.from, year, `${year}-01-01`), to: inYearOr(sp.to, year, `${year}-12-31`),
    // the checkbox + hidden „0“ send both values when ticked
    post: !post.split(',').every((x) => x === '0') || !post,
    sort: sp.sort === 'nal' ? 'nal' : 'date', m: akMode(sp.m), k: /^\d{1,10}$/.test(sp.k ?? '') ? sp.k! : '',
    pid: sp.pid && /^[0-9a-f-]{36}$/i.test(sp.pid) ? sp.pid : '', f: akFilter(sp.f), g: sp.g === '1',
    at: /^[0-9a-f-]{1,36}$/i.test(sp.at ?? '') ? sp.at : '',
  };
  if (s.from > s.to) s.from = `${year}-01-01`;

  if (!s.k) {
    const [lines, chart] = await Promise.all([aggregatedLines(firm.id, s.from, s.to), effectiveChart(db(), firm.id)]);
    return (
      <>
        <Hd t="Аналитика" sub="Избор на конто за аналитика" />
        <KontoStep s={s} rows={kontoRows(lines, chart, { post: s.post })} />
      </>
    );
  }

  const [lines, P, chart] = await Promise.all([finLines(firm.id, `${year}-01-01`, s.to, { kontos: [s.k] }), partnerMap(firm.id), effectiveChart(db(), firm.id)]);
  const kName = chart.find((a) => a.code === s.k)?.name ?? '';
  const partnerK = isPartnerKonto(s.k, lines);
  const td = todayIso();
  const list = partnerK ? partnerRows(lines, P, { k: s.k, from: s.from, to: s.to, asOf: td < s.to ? td : s.to, flt: s.f }) : [];

  if (partnerK && !s.pid) {
    return (
      <>
        <Hd t="Аналитика" sub={`${s.k} ${kName} · комитенти`}>
          <ExportBar pdf={false} name={`Analitika_${s.k}_komitenti`} title={`Комитенти ${s.k}`} rows={[
            ['Шифра', 'Име', 'Должи', 'Побарува', 'Салдо', 'Доспеан износ', 'Доцни ден.', 'Салдо ПС', 'Дополнителен назив', 'Жиро с-ка', 'Град', 'ЕДБ/ЕМБС', 'Адреса'],
            ...list.map((r) => [r.code, r.name, r.d, r.p, r.s, r.over, r.late, r.ps, r.extra, r.bank, r.city, r.ids, r.address]),
          ]} />
        </Hd>
        <PartnerStep s={s} kName={kName} rows={list} />
      </>
    );
  }

  const p = s.pid ? P.get(s.pid) : undefined;
  if (s.pid && !p) return <><Hd t="Аналитика" /><div className="callout warn">Комитентот не е најден. <a href={akHref(s, { pid: '' })}>← Назад</a></div></>;
  const d = await kkData(firm.id, year, { k: s.k, sub: '1', p: p ? p.id : undefined, from: s.from, to: s.to });
  // F4 / F5 walk the partner list as filtered; a partner outside the filter still walks it from the start
  const nb = p ? neighbours(list, p.id) : { i: -1, prev: null, next: null };
  const partner = p ? { code: p.code ?? '', name: p.name, bank: p.bankAccount ?? '' } : null;
  return (
    <>
      <Hd t="Аналитика" sub={`${s.k} ${kName}${p ? ' · ' + p.name : ''}`} excel={false}>
        <ExportBar pdf={false} name={`Analitika_${s.k}${p?.code ? '_' + p.code : ''}_${s.from}_${s.to}`} title={`Аналитика ${s.k}`} rows={cardRows(d, partner)} />
      </Hd>
      <CardStep s={s} d={d} firmName={firm.name} partner={partner} prev={nb.prev} next={nb.next} pos={nb.i >= 0 ? { i: nb.i, n: list.length } : undefined} />
    </>
  );
}
