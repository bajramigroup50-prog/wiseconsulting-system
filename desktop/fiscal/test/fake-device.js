'use strict';
// In-memory Datecs-family printer for the driver tests: a transport whose "device" parses host frames, keeps a receipt
// state and answers like a PF550 (status bytes, counters, NAK / SYN on demand).
const P = require('../datecs');
const cp = require('../cp1251');

function fakeDevice(opts = {}) {
  const st = { open: false, storno: false, lines: [], total: 0, paid: 0, receipts: opts.receipts || 41, z: opts.z || 7, cash: 0, log: [] };
  const faults = { paper: !!opts.paper, nakOnce: !!opts.nakOnce, synOnce: !!opts.synOnce, silent: !!opts.silent, failCmd: opts.failCmd || 0 };
  let onData = () => {};
  let lastSeq = -1, lastAnswer = null;
  let rx = Buffer.alloc(0);
  const status = (err = {}) => {
    const s = [0x80, 0x80, 0x80, 0x80, 0x80, 0x80 | 0x08]; // fiscal mode (5.3)
    if (faults.paper) s[2] |= 0x01;
    if (st.open) s[2] |= 0x08;
    if (err.notAllowed) s[1] |= 0x02;
    if (err.syntax) s[0] |= 0x01;
    return s;
  };
  const reply = (seq, cmd, data, s) => { lastSeq = seq; lastAnswer = P.buildAnswer(seq, cmd, cp.encode(data), s); setImmediate(() => onData(lastAnswer)); };

  function handle(f) {
    const { seq, cmd } = f;
    const data = f.data;
    st.log.push({ cmd, data });
    if (faults.silent) return;
    if (seq === lastSeq && lastAnswer) { setImmediate(() => onData(lastAnswer)); return; } // repeated SEQ → repeat answer
    if (faults.nakOnce) { faults.nakOnce = false; setImmediate(() => onData(Buffer.from([P.NAK]))); return; }
    if (faults.synOnce && cmd === P.CMD.DAILY_REPORT) { faults.synOnce = false; setImmediate(() => onData(Buffer.from([P.SYN]))); setTimeout(() => reply(seq, cmd, `${String(st.z + 1).padStart(4, '0')},000000123.45,000000100.00,000000020.00,000000003.45,000000000.00`, status()), 30); st.z++; return; }
    if (faults.failCmd === cmd) return reply(seq, cmd, '', status({ notAllowed: true }));
    const printing = [P.CMD.OPEN, P.CMD.OPEN_STORNO, P.CMD.SALE, P.CMD.CLOSE, P.CMD.CLOSE_STORNO, P.CMD.DAILY_REPORT];
    if (faults.paper && printing.includes(cmd)) return reply(seq, cmd, '', status());
    switch (cmd) {
      case P.CMD.STATUS: return reply(seq, cmd, '', status());
      case P.CMD.DIAG: return reply(seq, cmd, '1.40 10Jan24 1200,ABCD,0000,1,AC123456,50123456', status());
      case P.CMD.OPEN: case P.CMD.OPEN_STORNO:
        if (st.open) return reply(seq, cmd, '', status({ notAllowed: true }));
        st.open = true; st.storno = cmd === P.CMD.OPEN_STORNO; st.lines = []; st.total = 0; st.paid = 0;
        return reply(seq, cmd, `${String(st.receipts).padStart(4, '0')},0000`, status());
      case P.CMD.SALE: {
        const m = /\t@?([А-Г])(\d+\.\d{2})\*(\d+\.\d{3})$/.exec(data);
        if (!st.open || !m) return reply(seq, cmd, '', status({ syntax: !m, notAllowed: !st.open }));
        st.lines.push({ text: data.split('\t')[0], vat: m[1], price: Number(m[2]), qty: Number(m[3]) });
        st.total = Math.round((st.total + Number(m[2]) * Number(m[3])) * 100) / 100;
        return reply(seq, cmd, '', status());
      }
      case P.CMD.SUBTOTAL: {
        const pct = Number(data.split(',')[1] || 0);
        st.total = Math.round(st.total * (1 + pct / 100) * 100) / 100;
        return reply(seq, cmd, `${st.total.toFixed(2)}`, status());
      }
      case P.CMD.TOTAL: {
        const m = /\t([PNCD])?(\d+\.\d{2})?$/.exec(data);
        const amt = m && m[2] ? Number(m[2]) : Math.round((st.total - st.paid) * 100) / 100;
        st.paid = Math.round((st.paid + amt) * 100) / 100;
        const due = Math.round((st.total - st.paid) * 100) / 100;
        return reply(seq, cmd, due > 0 ? `D+${due.toFixed(2)}` : `R+${(-due).toFixed(2)}`, status());
      }
      case P.CMD.CLOSE: case P.CMD.CLOSE_STORNO:
        if (!st.open || st.paid < st.total) return reply(seq, cmd, '', status({ notAllowed: true }));
        st.open = false; st.receipts++;
        return reply(seq, cmd, `${String(st.receipts).padStart(4, '0')},${String(st.receipts).padStart(4, '0')}`, status());
      case P.CMD.LAST_DOC: return reply(seq, cmd, String(st.receipts).padStart(7, '0'), status());
      case P.CMD.DATETIME: return reply(seq, cmd, '12-10-26 13:45:07', status());
      case P.CMD.DAILY_REPORT: if (data === '0') st.z++; return reply(seq, cmd, `${String(st.z).padStart(4, '0')},000000123.45,000000100.00,000000020.00,000000003.45,000000000.00`, status());
      case P.CMD.CASH: { const v = Number(data); if (st.cash + v < 0) return reply(seq, cmd, `F,${st.cash.toFixed(2)},0,0`, status()); st.cash += v; return reply(seq, cmd, `P,${st.cash.toFixed(2)},0,0`, status()); }
      case P.CMD.DIAG_PRINT: return reply(seq, cmd, '', status());
      case P.CMD.VAT_RATES: return opts.rates === null ? reply(seq, cmd, '', status({ syntax: true })) : reply(seq, cmd, opts.rates || '18.00%,5.00%,10.00%,0.00%', status());
      default: return reply(seq, cmd, '', status({ syntax: true }));
    }
  }

  const transport = {
    label: 'fake',
    open: async () => {},
    close: async () => {},
    onData: (f) => { onData = f; },
    write: async (buf) => {
      rx = Buffer.concat([rx, buf]);
      for (;;) {
        const r = P.parseFrame(rx);
        if (!r) break;
        rx = r.rest;
        handle(r.frame);
      }
    },
  };
  return { transport, state: st, faults };
}

module.exports = { fakeDevice };
