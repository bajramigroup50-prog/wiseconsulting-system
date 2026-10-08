/**
 * A realistic month of bank rows for one firm, in the legacy shape (denars). Converted to the
 * port's cents shape by `toPort` in the test.
 */
export const firm = {
  id: 'f1',
  name: 'Вајс Консалтинг ДООЕЛ Скопје',
  banks: [
    { id: 'main', name: 'Халк МКД', account: '270000012345678', konto: '1000' },
    { id: 'eur', name: 'Халк EUR', account: '270000012345999', konto: '1030', cur: 'EUR' },
  ],
  rules: [{ match: 'телеком', konto: '4200', learned: true }],
  osnovK: { '930|out': '4199' } as Record<string, string>,
  posK: '1200001',
  posP: 'p4',
};

export const partners = [
  { id: 'p1', name: 'АБЦ Трејд ДООЕЛ', edb: '4030000000001' },
  { id: 'p2', name: 'Бета ДОО' },
  { id: 'p3', name: 'Гама Комерц' },
  { id: 'p4', name: 'POS терминал (плаќања со картички)', pos: true },
  { id: 'p5', name: 'ACME GmbH' },
  { id: 'p6', name: 'Delta Import' },
];

export const invoices = [
  { id: 'i1', number: '45/2026', partner: 'p1', total: 59000, date: '2026-03-01' },
  { id: 'i2', number: '46/2026', partner: 'p1', total: 35400, date: '2026-03-05' },
  { id: 'i3', number: '47/2026', partner: 'p3', total: 10000, date: '2026-02-01' },
  { id: 'i4', number: '48/2026', partner: 'p3', total: 15000, date: '2026-02-10' },
  { id: 'i5', number: '52/2026', partner: 'p3', total: 7000, date: '2026-03-01' },
  { id: 'i6', number: 'EX-3/2026', partner: 'p5', total: 61500, date: '2026-02-20', cur: 'EUR', fx: 61.5 },
  { id: 'i11', number: 'EX-4/2026', partner: 'p5', total: 123000, date: '2026-02-25', cur: 'EUR', fx: 61.5 },
  { id: 'i8', number: '120/2025', partner: 'p2', total: 4720, date: '2025-12-01' },
  { id: 'i9', number: '53/2026', partner: 'p1', total: 12000, date: '2026-03-10' },
  { id: 'i10', number: '54/2026', partner: 'p1', total: 8000, date: '2026-03-12' },
  { id: 'i12', number: '55/2026', partner: 'p2', total: 9440, date: '2026-03-12', paidOther: 1000 },
  { id: 'c1', number: '1/2026', partner: 'p1', total: 5000, date: '2026-03-13', credit: true },
];

export const purchases = [
  { id: 'u1', number: 'F-1234', partner: 'p2', total: 12500, date: '2026-03-02' },
  { id: 'u2', number: 'INV-2026-77', partner: 'p6', total: 30000, date: '2026-03-03', imp: true, supKonto: '2210' },
  { id: 'u4', number: 'K-9', partner: 'p2', total: 800, date: '2026-03-04', cash: true },
];

export const pay = [{ amount: 45000, month: '2026-02', konto: '2401' }];

export const rows = [
  { id: 'b1', acct: 'main', date: '2026-03-15', amount: 59000, desc: 'ABC TRADE DOOEL SKOPJE – Uplata po faktura br. 45/2026', name: 'ABC TRADE DOOEL SKOPJE' },
  { id: 'b2', acct: 'main', date: '2026-03-15', amount: -12500, desc: 'BETA DOO – Plakanje faktura 1234-25 materijali', name: 'BETA DOO' },
  { id: 'b3', acct: 'main', date: '2026-03-15', amount: -350, desc: 'Надомест за одржување на сметка' },
  { id: 'b4', acct: 'main', date: '2026-03-16', amount: 35400, desc: 'АБЦ ТРЕЈД ДООЕЛ – Уплата по фактура 46/2026 – Продажба на стоки', name: 'АБЦ ТРЕЈД ДООЕЛ', osnov: '200' },
  { id: 'b5', acct: 'main', date: '2026-03-16', amount: -9000, desc: 'Управа за јавни приходи – ДДВ за 02/2026', name: 'Управа за јавни приходи', osnov: '930' },
  { id: 'b6', acct: 'main', date: '2026-03-16', amount: -460, desc: 'Налог 78' },
  { id: 'b7', acct: 'main', date: '2026-03-16', amount: 600, desc: 'Гама Комерц & Ко – Уплата аванс', name: 'Гама Комерц & Ко', osnov: '250' },
  { id: 'b8', acct: 'main', date: '2026-03-19', amount: 22000, desc: 'ГАМА КОМЕРЦ & КО – Уплата по ф-ри за февруари', name: 'ГАМА КОМЕРЦ & КО' },
  { id: 'b9', acct: 'eur', date: '2026-03-16', amount: 61600, amountCur: 1000, cur: 'EUR', desc: 'ACME GMBH – INV EX-3/2026', name: 'ACME GMBH' },
  { id: 'b10', acct: 'eur', date: '2026-03-17', amount: 30775, amountCur: 500, cur: 'EUR', desc: 'ACME GMBH – part payment EX-4/2026', name: 'ACME GMBH' },
  { id: 'b11', acct: 'main', date: '2025-12-30', amount: 4720, desc: 'Бета ДОО - уплата' },
  { id: 'b12', acct: 'main', date: '2026-03-19', amount: -4500, desc: 'Телеком АД – Телеком месечна сметка 03/2026 <интернет>', name: 'Телеком АД' },
  { id: 'b13', acct: 'main', date: '2026-03-19', amount: -42, desc: 'Провизија за платен промет' },
  { id: 'b14', acct: 'main', date: '2026-03-20', amount: 9850, desc: 'CASYS POS PRILIV 19.03' },
  { id: 'b15', acct: 'main', date: '2026-03-20', amount: -1200, desc: 'Комунална такса', osnov: '930' },
  { id: 'b16', acct: 'main', date: '2026-03-20', amount: -45000, desc: 'Исплата плата 02/2026' },
  { id: 'b17', acct: 'main', date: '2026-03-20', amount: 20000, desc: 'АБЦ ТРЕЈД ДООЕЛ – Уплата по фактури бр. 53/2026 и 54/2026', name: 'АБЦ ТРЕЈД ДООЕЛ' },
  { id: 'b18', acct: 'main', date: '2026-03-21', amount: 8440, desc: 'ДРУГ ПЛАЌАЧ – уплата', name: 'ДРУГ ПЛАЌАЧ' },
  { id: 'b19', acct: 'main', date: '2026-03-21', amount: -30000, desc: 'DELTA IMPORT – INV 2026-77', name: 'DELTA IMPORT' },
  { id: 'b20', acct: 'main', date: '2026-03-21', amount: 777, desc: 'Непознат прилив' },
  { id: 'b22', acct: 'main', date: '2026-03-02', amount: -5000, desc: 'Кирија', konto: '4400' },
];
