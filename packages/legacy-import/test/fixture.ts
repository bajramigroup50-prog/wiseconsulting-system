/**
 * Small synthetic legacy backup in the exact shape `bkpRun` writes (`{v:1, at, firm, data:{<14 COLS>}}`).
 * Values are invented; field names and structures follow legacy/index.html (see README.md).
 */
export function fixtureBackup() {
  return {
    v: 1,
    at: '2026-10-01T08:00:00.000Z',
    firm: {
      id: 'mf1abc', name: 'ТЕСТ ТРГОВИЈА ДООЕЛ', code: '017', lf: 'dooel', edb: '4030999000001', embs: '7000001', address: 'Ул. Тест 1', city: 'Скопје',
      ddv: true, per: 'quarter', lock: '2026-03-31', crMode: 'minus', nalogMode: 'period',
      banks: [{ id: 'b1', name: 'Стопанска банка', account: '200000000000001', konto: '1000', cur: 'MKD' }],
      accounts: { '10001': { mk: 'Жиро сметка 2' } },
      izv: { 'b1:2026-02-05': '12' },
      sch: { stock: '6600' },
      mods: ['hotel'],
      invColor: '#123456',
      logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    },
    data: {
      codes: [{ id: 'w1', cb: 'warehouse', code: '02', name: 'Магацин 2' }],
      employees: [{ id: 'e1', no: '1', name: 'Ана Анова', embg: '0101990450001', netBase: 30000, start: '2025-01-01', ct: { type: 'неопределено' } }],
      partners: [
        { id: 'p1', code: '1', name: 'Купувач ДОО', edb: '4030000000011', rate: 18, konto: '7400', type: 'service', manager: 'Марко' },
        { id: 'p2', code: '2', name: 'Добавувач ДОО', edb: '4030000000022' },
        { id: 'p3', code: '1', name: 'Друг со иста шифра' },
      ],
      items: [{ id: 'i1', code: 'A1', name: 'Артикл 1', type: 'goods', unit: 'ком', price: 1000, rate: 18, barcode: '5310000000017', sp: { w1: 1300 } }],
      invoices: [
        {
          id: 'inv1', number: '1/2026', date: '2026-02-01', due: '2026-02-15', partner: 'p1', wh: 'main',
          items: [{ name: 'Артикл 1', itemId: 'i1', unit: 'ком', qty: '2', price: '1000', disc: 0, rate: 18, konto: '7400' }],
          lines: [{ k: '1200', d: 2360, p: 0, partner: 'p1' }, { k: '7400', d: 0, p: 2000 }, { k: '230018', d: 0, p: 360, vb: 2000 }],
        },
        {
          id: 'inv2', number: '1/2026', credit: true, refInv: 'inv1', crKind: 'price', date: '2026-02-20', partner: 'p1',
          items: [{ name: 'Попуст', qty: 1, price: 100, rate: 18, konto: '7400' }],
          lines: [{ k: '1200', d: 0, p: 118, partner: 'p1' }, { k: '7400', d: 100, p: 0 }, { k: '230018', d: 18, p: 0 }],
          ed: { 1: { k0: '7400', d0: 0, p0: -100, k: '7401' } }, // overlay recorded on the storno line as the nalog showed it
        },
        { id: 'inv3', number: '3/2026', date: '2026-02-25', partner: 'p1', pend: true, items: [], lines: [{ k: '1200', d: 1, p: 0 }, { k: '7400', d: 0, p: 1 }] },
      ],
      purchases: [{
        id: 'pur1', number: 'F-77', date: '2026-02-03', partner: 'p2', ptype: 'stock', wh: 'main',
        groups: [{ konto: '6600', rate: 18, base: 6000, vat: 1080 }],
        stock: [{ item: 'i1', name: 'Артикл 1', qty: 10, price: 600, rab: 0, value: 6000 }],
        lines: [{ k: '6600', d: 6000, p: 0 }, { k: '130018', d: 1080, p: 0, vb: 6000 }, { k: '2200', d: 0, p: 7080 }],
      }],
      bank: [
        { id: 'bk1', acct: 'b1', date: '2026-02-05', amount: 2360, desc: 'Уплата ф-ра 1/2026', partner: 'p1', ref: { type: 'invoice', id: 'inv1', label: '1/2026' } },
        { id: 'bk2', acct: 'b1', date: '2026-02-05', amount: -7080, desc: 'Плаќање F-77', partner: 'p2', ref: { type: 'purchase', id: 'pur1', label: 'F-77' } },
      ],
      sales: [{
        id: 'z-2026-02-10', date: '2026-02-10', groups: [{ rate: 18, konto: '7600', base: 1000, vat: 180 }], total: 1180, count: 3,
        lines: [{ k: '1020', d: 1180, p: 0 }, { k: '7600', d: 0, p: 1000 }, { k: '230018', d: 0, p: 180, vb: 1000 }],
      }],
      journal: [
        { id: 'open-2026', kind: 'open', date: '2026-01-01', desc: 'Почетна состојба 2026', lines: [{ k: '1000', d: 50000, p: 0 }, { k: '9000', d: 0, p: 50000 }] },
        { id: 'jm1', date: '2026-02-28', desc: 'Камата', lines: [{ k: '4740', d: 150, p: 0 }, { k: '99999', d: 0, p: 150 }] },
        { id: 'ddv-2026-Т1', kind: 'ddv', date: '2026-03-31', desc: 'ДДВ Т1', lines: [{ k: '230018', d: 522, p: 0 }, { k: '130018', d: 0, p: 1080 }, { k: '1300', d: 558, p: 0 }] },
      ],
      payroll: [{
        id: 'pay-2026-01', v: 2, month: '2026-01', date: '2026-01-31', params: { pio: 18.8 }, locked: true,
        emps: [{ empId: 'e1', no: '1', name: 'Ана Анова', netBase: 30000, lines: [{ type: 'reg', cat: 'reg', hours: 168, amt: 0 }] }],
        lines: [{ k: '4200', d: 45000, p: 0 }, { k: '2400', d: 0, p: 30000 }, { k: '2410', d: 0, p: 15000 }],
      }],
      moves: [
        { id: 'pur-pur1-0-i1', date: '2026-02-03', item: 'i1', qty: 10, value: 6000, type: 'in', src: 'pur-pur1', wh: 'main', lines: [] },
        { id: 'inv-inv1-0-i1-sale', date: '2026-02-01', item: 'i1', qty: -2, value: -1200, type: 'sale', src: 'inv-inv1-0', wh: 'main', lines: [{ k: '7000', d: 1200, p: 0 }, { k: '6600', d: 0, p: 1200 }] },
      ],
      production: [],
      assets: [{ id: 'a1', name: 'Комбе', konto: '0136', rate: 25, date: '2025-06-01', cost: 900000, plate: 'SK-1234-AB', vehicle: true }],
      docs: [
        { id: 'blg1', type: 'blg', kind: 'out', reg: '1020', date: '2026-02-12', number: 'И-001', merchant: 'Маркет', amt: 118, rate: 18, cat: 'office' },
        { id: 'loan1', type: 'loan', konto: '4200', dir: 'given', no: 'З-1', date: '2026-02-01', amount: 5000 },
        { id: 'hr1', type: 'hroom', no: '101', beds: 2, price: 3000 },
        { id: 'out1', type: 'outscan', name: 'scan.pdf' },
        { id: 'arch1', type: 'arch', dos: true, sub: 'ugovori', title: 'Договор за закуп', date: '2025-05-05', files: [{ id: 'asset123', name: 'dogovor.pdf', type: 'application/pdf', size: 1000 }] },
      ],
    },
  };
}
