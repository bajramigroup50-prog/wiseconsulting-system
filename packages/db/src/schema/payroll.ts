/**
 * Schema — Phase 6 "payroll & HR": employees, payroll runs (legacy `payroll` v2 documents split into
 * runs / employees / lines), parameter overrides, firm payroll settings, pay-change notes, MPIN exports,
 * employment contracts and the HR registry (legacy `docs.type='hr'`).
 *
 * A payroll run posts one journal through the posting service (`sourceType='payroll'`, kind `plati`);
 * `journal_id` mirrors it for navigation only.
 *
 * Fixes built into the model (see `packages/db/src/payroll.ts` for the rest):
 * - FIX(#10): parameter overrides are per firm (`firm_id`), with optional office-wide rows (`firm_id` null).
 * - FIX(#11): MPIN exports and UJP acceptances are separate rows by `kind` — no shared `mpin-{month}` id.
 * - FIX(#16/#17): HR registry numbers are unique per firm; the control code is a column on the row.
 * - FIX(#4): pay-change notes are their own table, so they cannot collide with travel orders (Phase 9).
 */
import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, check, customType, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';
import { journals } from './books';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 10, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 8, scale: 4 });
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => 'bytea' });
const userRef = (name: string) => uuid(name).references(() => users.id, { onDelete: 'set null' });

/* ---------------- Employees ---------------- */

/** Employees (legacy `employees` collection, fields 6813). */
export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  legacyId: text('legacy_id'),
  /** Employee number (шифра) — ordering key of payroll runs. */
  no: text('no'),
  name: text('name').notNull(),
  embg: text('embg'),
  position: text('position'),
  /** Organisational unit / branch (ОЕ, пункт) — used to group payslip e-mails. */
  oe: text('oe'),
  city: text('city'),
  address: text('address'),
  email: text('email'),
  /** Agreed full-month net and complexity coefficient. */
  netBase: money('net_base').notNull().default('0'),
  coef: rate('coef').notNull().default('1'),
  start: date('start'),
  end: date('end'),
  /** Previous service in years (may be fractional) and seniority without a start date. */
  stazPrev: numeric('staz_prev', { precision: 6, scale: 2 }),
  stazY: numeric('staz_y', { precision: 6, scale: 2 }),
  /** 'определено' | 'неопределено' (legacy wording kept). */
  contract: text('contract'),
  bankAcc: text('bank_acc'),
  bank: text('bank'),
  /** MPIN codes: 3.4ц municipality, 3.4б ФЗО unit, column 26 (0050 full / 0047 part time). */
  mpOps: text('mp_ops'),
  mpZan: text('mp_zan'),
  mpC26: text('mp_c26'),
  /** Personal monthly hour fund (part time only, e.g. 88). */
  hNorm: qty('h_norm'),
  leaveDays: integer('leave_days').notNull().default(20),
  m1Date: date('m1_date'),
  lekDate: date('lek_date'),
  bzrDate: date('bzr_date'),
  active: boolean('active').notNull().default(true),
  endReason: text('end_reason'),
  endDocNo: text('end_doc_no'),
  /** Remaining legacy fields (files[] → file_links, notes…). */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('employees_firm_name_idx').on(t.firmId, t.name),
  uniqueIndex('employees_firm_embg_uq').on(t.firmId, t.embg).where(sql`${t.embg} is not null and ${t.embg} <> ''`),
  uniqueIndex('employees_firm_legacy_uq').on(t.firmId, t.legacyId).where(sql`${t.legacyId} is not null`),
]);

/* ---------------- Payroll runs ---------------- */

/** One payroll month of a firm (legacy `payroll/pay-YYYY-MM`, v2). */
export const payrollRuns = pgTable('payroll_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  legacyId: text('legacy_id'),
  /** YYYY-MM */
  month: text('month').notNull(),
  /** Last day of the month — booking date of the journal. */
  date: date('date').notNull(),
  /** Complete parameter set used by the calculation (`PayParams`, incl. `hours` and `pfrom`). */
  params: jsonb('params').$type<Record<string, unknown>>().notNull(),
  /** `draft` = saved hours, not booked; `posted` = calculated and booked (journal exists). */
  status: text('status').$type<'draft' | 'posted'>().notNull().default('draft'),
  /** Month locked against changes (legacy `locked`). */
  locked: boolean('locked').notNull().default(false),
  journalId: uuid('journal_id').references(() => journals.id, { onDelete: 'set null' }),
  /** How the run was created: calendar draft, copy of the previous month, Excel import. */
  source: text('source').notNull().default('cal'),
  /** Totals snapshot at the last calculation: gross, net, contr, tax, dopl, emps. */
  totals: jsonb('totals').$type<Record<string, number>>().notNull().default({}),
  createdBy: userRef('created_by'),
  updatedBy: userRef('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('payroll_runs_firm_month_uq').on(t.firmId, t.month),
  check('payroll_runs_month_chk', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check('payroll_runs_status_chk', sql`${t.status} in ('draft','posted')`),
]);

/** Employee row of a run (legacy `payroll.emps[]`) — a snapshot, not a live link to `employees`. */
export const payrollEmp = pgTable('payroll_emp', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'set null' }),
  pos: integer('pos').notNull(),
  no: text('no'),
  name: text('name').notNull(),
  embg: text('embg'),
  netBase: money('net_base').notNull().default('0'),
  grossBase: money('gross_base'),
  coef: rate('coef').notNull().default('1'),
  stazY: numeric('staz_y', { precision: 6, scale: 2 }),
  hNorm: qty('h_norm'),
  short: boolean('short').notNull().default(false),
  union: boolean('union').notNull().default(false),
  noTax: boolean('no_tax').notNull().default(false),
  adv: boolean('adv').notNull().default(false),
  /** full | in (joined) | out (left) during the month. */
  inout: text('inout').notNull().default('full'),
  ioDate: date('io_date'),
  /** Calculation snapshot (whole denars). */
  gross: money('gross').notNull().default('0'),
  contr: money('contr').notNull().default('0'),
  tax: money('tax').notNull().default('0'),
  net: money('net').notNull().default('0'),
}, (t) => [
  index('payroll_emp_run_idx').on(t.runId, t.pos),
  index('payroll_emp_employee_idx').on(t.firmId, t.employeeId),
]);

/** Hour / amount line of an employee in a run (legacy `emps[].lines[]`). */
export const payrollLines = pgTable('payroll_lines', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runEmpId: uuid('run_emp_id').notNull().references(() => payrollEmp.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  pos: integer('pos').notNull(),
  type: text('type').notNull(),
  /** PSIF code (001–603 or firm-defined). */
  code: text('code'),
  /** reg | dop | bol | odm | kor | sin */
  cat: text('cat').notNull(),
  hours: qty('hours').notNull().default('0'),
  pct: numeric('pct', { precision: 8, scale: 2 }),
  amt: money('amt').notNull().default('0'),
  payer: text('payer'),
  mpin: text('mpin'),
}, (t) => [
  index('payroll_lines_emp_idx').on(t.runEmpId, t.pos),
  check('payroll_lines_cat_chk', sql`${t.cat} in ('reg','dop','bol','odm','kor','sin')`),
]);

/* ---------------- Parameters & settings ---------------- */

/**
 * Payroll parameter overrides on top of the statutory table `PAY_DEF` (legacy `settings/pay`).
 * FIX(#10): legacy kept one global list for all firms; here `firm_id` scopes a row to a firm, `firm_id IS NULL`
 * rows apply to every firm (office-wide, e.g. when УЈП publishes new amounts) and a firm row for the same
 * month wins. Empty columns keep the value of the previous row.
 */
export const payrollParams = pgTable('payroll_params', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'cascade' }),
  /** Valid from month (YYYY-MM). */
  from: text('from').notNull(),
  avg: money('avg'),
  minBase: money('min_base'),
  maxBase: money('max_base'),
  exempt: money('exempt'),
  minGross: money('min_gross'),
  minNet: money('min_net'),
  pio: rate('pio'),
  zdr: rate('zdr'),
  dop: rate('dop'),
  vrab: rate('vrab'),
  tax: rate('tax'),
  src: text('src'),
  updatedBy: userRef('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('payroll_params_global_uq').on(t.from).where(sql`${t.firmId} is null`),
  uniqueIndex('payroll_params_firm_uq').on(t.firmId, t.from).where(sql`${t.firmId} is not null`),
  check('payroll_params_from_chk', sql`${t.from} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
]);

/**
 * Per-firm payroll settings: posting accounts (pay_* scheme overrides), payment-order accounts and revenue
 * codes (FIX #19: legacy read a never-written `firm.ppAcc`), the MPIN template parsed from an earlier MPI3 file,
 * the HR registry number prefix and the payslip e-mail addresses per unit.
 */
export const payrollSettings = pgTable('payroll_settings', {
  firmId: uuid('firm_id').primaryKey().references(() => firms.id, { onDelete: 'cascade' }),
  scheme: jsonb('scheme').$type<Record<string, string>>().notNull().default({}),
  orders: jsonb('orders').$type<Record<string, unknown>>().notNull().default({}),
  mpinTemplate: jsonb('mpin_template').$type<Record<string, unknown> | null>(),
  hrPrefix: text('hr_prefix'),
  groupMail: jsonb('group_mail').$type<Record<string, string>>().notNull().default({}),
  updatedBy: userRef('updated_by'),
  updatedAt: updatedAt(),
});

/** Pay-change notes from the client (legacy `firm.payNotes`, `pn*`). Open notes block calculating the month. */
export const payrollNotes = pgTable('payroll_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  /** Valid from month (YYYY-MM). */
  month: text('month').notNull(),
  type: text('type').notNull(),
  employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'set null' }),
  empName: text('emp_name'),
  amount: money('amount'),
  text: text('text'),
  done: boolean('done').notNull().default(false),
  doneAt: ts('done_at'),
  doneBy: userRef('done_by'),
  doneMonth: text('done_month'),
  createdBy: userRef('created_by'),
  createdAt: createdAt(),
}, (t) => [index('payroll_notes_firm_idx').on(t.firmId, t.done, t.month)]);

/**
 * Files produced or received for a run: `mpin-txt` (MPI3 declaration), `mpin-xlsx`, `mpin-ack` (UJP acceptance,
 * Phase 3 AI reading). FIX(#7/#11): one row per export, written only after the file was produced successfully.
 */
export const payrollExports = pgTable('payroll_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'mpin-txt' | 'mpin-xlsx' | 'mpin-ack'>().notNull(),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  content: bytea('content'),
  /** Summary (employees, gross, obligations, warnings). */
  info: jsonb('info').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: userRef('created_by'),
  createdAt: createdAt(),
}, (t) => [index('payroll_exports_run_idx').on(t.runId, t.kind, t.createdAt)]);

/* ---------------- Contracts & HR registry ---------------- */

/** Employment contract terms (legacy `employees.ct`); the employee's current contract has `current = true`. */
export const hrContracts = pgTable('hr_contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  current: boolean('current').notNull().default(true),
  /** neopr | opr | skr | sez | dom */
  type: text('type').notNull(),
  no: text('no').notNull(),
  signDate: date('sign_date').notNull(),
  place: text('place'),
  start: date('start').notNull(),
  end: date('end'),
  /** First start of a chain of fixed-term extensions (5-year rule). */
  firstStart: date('first_start'),
  reason: text('reason'),
  position: text('position'),
  duties: text('duties'),
  workPlace: text('work_place'),
  hours: numeric('hours', { precision: 5, scale: 2 }).notNull().default('40'),
  probation: integer('probation'),
  gross: money('gross'),
  net: money('net'),
  leave: integer('leave').notNull().default(20),
  notice: integer('notice').notNull().default(1),
  rep: text('rep'),
  repRole: text('rep_role'),
  /** Remaining terms: special clauses `sp`, history of extensions `hist[]`, … */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: userRef('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('hr_contracts_current_uq').on(t.employeeId).where(sql`${t.current}`),
  index('hr_contracts_firm_idx').on(t.firmId, t.signDate),
]);

/**
 * HR registry (деловодник за вработени; legacy `docs.type='hr'`): contracts, annexes and decisions on
 * extension/transformation, disciplinary documents (`di-*`), annual leave decisions and sick-leave records.
 * `snap` keeps the document data as printed so the document can be re-printed exactly.
 */
export const hrDocs = pgTable('hr_docs', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'set null' }),
  contractId: uuid('contract_id').references(() => hrContracts.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  no: text('no').notNull(),
  date: date('date').notNull(),
  empName: text('emp_name').notNull(),
  /** Contract type for `contract` rows. */
  ctype: text('ctype'),
  start: date('start'),
  end: date('end'),
  /** Days (leave / sick leave). */
  days: numeric('days', { precision: 6, scale: 1 }),
  position: text('position'),
  /** Number of the contract an annex/decision refers to. */
  refNo: text('ref_no'),
  transform: boolean('transform').notNull().default(false),
  /** Control code printed on the document (legacy `docCode`). */
  code: text('code'),
  title: text('title'),
  snap: jsonb('snap').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: userRef('created_by'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('hr_docs_firm_no_uq').on(t.firmId, t.no),
  index('hr_docs_firm_date_idx').on(t.firmId, t.date),
  index('hr_docs_employee_idx').on(t.employeeId),
  index('hr_docs_code_idx').on(t.code),
  check('hr_docs_no_chk', sql`length(trim(${t.no})) > 0`),
]);

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type PayrollRunRow = typeof payrollRuns.$inferSelect;
export type PayrollEmpRow = typeof payrollEmp.$inferSelect;
export type PayrollLineRow = typeof payrollLines.$inferSelect;
export type PayrollParamRow = typeof payrollParams.$inferSelect;
export type PayrollSettingsRow = typeof payrollSettings.$inferSelect;
export type PayrollNote = typeof payrollNotes.$inferSelect;
export type HrContractRow = typeof hrContracts.$inferSelect;
export type HrDoc = typeof hrDocs.$inferSelect;
