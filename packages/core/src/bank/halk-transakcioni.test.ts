import { describe, expect, it } from 'vitest';
import { detectStatementFormat, parseStatementFile } from '../bank-parsers';
import { keywordKonto, ownTransferBy, BANK_KONTA, type BankRow } from '../bank-match';

// Halk denar account e-banking export (2026): root `TransakcioniRacunPrivredaIzvod`, counterparty in `KomitentNaziv`,
// payment code in `SifraPlacanja` — synthetic data, same layout
const XML = `<TransakcioniRacunPrivredaIzvod>
<Zaglavlje IzvodID="1" BrojIzvoda="201" DatumIzvoda="14.10.2026" MaticniBroj="4080000000001" Partija="270000000000111" PrethodnoStanje="1000" DugovniPromet="70" PotrazniPromet="300" NovoStanje="1230" NAZIV_NALOGODAVCA="ДЕМО ФИРМА ДООЕЛ Скопје"/>
<Stavke VasBrojNaloga="1 " BrojRacunaPrimaocaPosiljaoca="270000000010654" Opis="надоместок" KomitentNaziv="ХАЛКБАНК АД Скопје - Провизија" SifraPlacanja="666" SifraPlacanjaOpis="Плаќање провизија на банки" Duguje="70" Potrazuje="0" PozivNaBrojZaduzenjaOdobrenja="" PozivNaBrojKorisnika="" Referenca="" DatumValute="14.10.2026"/>
<Stavke VasBrojNaloga="2 " BrojRacunaPrimaocaPosiljaoca="270000000000222" Opis="Пренос од средства на делот на правно лице и обратно" KomitentNaziv="ДЕМО ФИРМА ДООЕЛ Скопје-КУМАНОВО" SifraPlacanja="903" SifraPlacanjaOpis="Пренос од средства на делот на правно лице и обратно" Duguje="0" Potrazuje="100" PozivNaBrojZaduzenjaOdobrenja="пренос" DatumValute="14.10.2026"/>
<Stavke VasBrojNaloga="3 " BrojRacunaPrimaocaPosiljaoca="270000000100476" Opis="11.10.2026 " KomitentNaziv="ДЕМО ФИРМА ДООЕЛ Скопје СКОПЈЕ - ЦЕНТАР" SifraPlacanja="800" SifraPlacanjaOpis="Уплата во готово на сопствена сметка од днев. пазар" Duguje="0" Potrazuje="200" DatumValute="14.10.2026"/>
</TransakcioniRacunPrivredaIzvod>`;

describe('Halk TransakcioniRacunPrivredaIzvod (denar account)', () => {
  it('is recognised and read with counterparty, code, reference and balances', () => {
    expect(detectStatementFormat(XML, '2026201.xml')).toBe('halk-xml');
    const [s] = parseStatementFile(XML, '2026201.xml')!;
    expect(s).toMatchObject({ account: '270000000000111', no: '201', date: '2026-10-14', opening: 100000, closing: 123000, debit: 7000, credit: 30000, owner: 'ДЕМО ФИРМА ДООЕЛ Скопје' });
    expect(s!.lines).toHaveLength(3);
    expect(s!.lines[0]).toMatchObject({ amount: -7000, counterparty: 'ХАЛКБАНК АД Скопје - Провизија', osnov: '666', iban: '270000000010654' });
    expect(s!.lines[1]).toMatchObject({ amount: 10000, osnov: '903', ref: 'пренос' });
    expect(s!.lines[2]!.purpose).toContain('днев. пазар');
  });
  it('code 800 is the daily turnover (1009), code 903 an own transfer even without a registered account', () => {
    const [s] = parseStatementFile(XML, '2026201.xml')!;
    const row = (i: number): BankRow => { const l = s!.lines[i]!; return { id: String(i), acct: 'a', amount: l.amount / 100, desc: l.desc, purpose: l.purpose, osnov: l.osnov, name: l.counterparty, counterAccount: l.iban } as BankRow; };
    const accounts = [{ id: 'a', account: '270000000000111', konto: '100005', cur: 'MKD' }] as never;
    expect(keywordKonto(row(2), accounts, BANK_KONTA)?.konto).toBe(BANK_KONTA.dailyTurnover);
    const ctx = { firmName: 'НЕКОЈА ДРУГА ФИРМА', firmEdb: '', accounts, partners: [], konta: BANK_KONTA } as never;
    expect(ownTransferBy(row(1), ctx)).not.toBeNull();
    expect(ownTransferBy(row(0), ctx)).toBeNull();
  });
});
