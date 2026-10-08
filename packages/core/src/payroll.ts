/**
 * Payroll domain logic (Phase 6) — pure TypeScript, no I/O.
 * Ported from the final effective legacy versions (see docs/LEGACY-MAP.md, Phase 6) and
 * golden-tested against `legacy/index.html` in `test/golden/payroll/`.
 *
 * Deliberate fixes are documented at the top of each module:
 *  - ./payroll/params   one dated parameter source, no PIO 18.8 / вработување 1.2 fallbacks
 *  - ./payroll/calc     maximum contribution base applied
 *  - ./payroll/entries  explicit payroll accounts honoured (no SCH_OLD guard)
 *  - ./payroll/mpin     header rates from the run's params, employee codes beat template
 *  - ./payroll/cp1251   complete windows-1251 table
 *  - ./payroll/calendar Bajram 2020–2024 added, extra holidays injectable
 */
export * from './payroll/params';
export * from './payroll/calendar';
export * from './payroll/calc';
export * from './payroll/entries';
export * from './payroll/cp1251';
export * from './payroll/mpin';
export * from './payroll/draft';
export * from './payroll/lines';
export * from './payroll/hr';
export * from './payroll/orders';
