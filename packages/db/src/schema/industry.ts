/**
 * Schema — Phase 10 "industry modules": hotel, rent-a-car, travel agency, construction, appointments, transport
 * (travel orders, freight for third parties) and the shared fleet. Restaurant tables / bills, client notes and the
 * freight document / fuel-card records are polymorphic `firm_docs` rows (types `rtable`, `rord`, `cnote`, `frdoc`,
 * `frfuel`), typed in `@wise/db` `industry/docs.ts`.
 *
 * Every module document that is invoiced keeps the id of the Phase 3 invoice it produced (`invoice_id`, set null when
 * the invoice is deleted) — industry modules never have their own invoice tables. Cash receipts (deposits,
 * travellers' payments, cash collected on delivery) are Phase 4 `cash_vouchers`.
 *
 * Module configuration lives in `firms.settings.industry.<module>` (FIX LEGACY-MAP 10.4 item 7: legacy used
 * `firm.hot`, `firm.rent`, `firm.tour`, `firm.svc`, `firm.cons`, `firm.pnDef` and a `docs` record `frcfg`).
 *
 * FIX (LEGACY-MAP 10.4 item 1, `pnSave` collision): travel orders have their own table (`travel_orders`) and their own
 * save function; legacy saved them through the payroll-notes `pnSave`, so they never persisted.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';
import { partners } from './books';
import { invoices } from './sales';
import { cashVouchers } from './bank';
import { employees } from './payroll';
import { fixedAssets } from './yearend';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const price = (name: string) => numeric(name, { precision: 18, scale: 4 });
const firmFk = () => uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' });
const partnerFk = (name = 'partner_id') => uuid(name).references(() => partners.id, { onDelete: 'restrict' });
const invoiceFk = (name = 'invoice_id') => uuid(name).references(() => invoices.id, { onDelete: 'set null' });
const voucherFk = (name: string) => uuid(name).references(() => cashVouchers.id, { onDelete: 'set null' });
const by = (name: string) => uuid(name).references(() => users.id, { onDelete: 'set null' });

/* ---------------- Fleet (rent-a-car, travel orders, freight) ---------------- */

/**
 * Vehicles of the firm (legacy: `assets` with `vehicle`/`plate`, rent fields `rent, rClass, rDay, rWeek, rDep, rKm,
 * rKmX, odo`, travel-order fields `fuelNorm, capKg, oilEvery…`). FIX (LEGACY-MAP 10.4 item 15): one fleet shared by
 * rent-a-car, travel orders and freight instead of each module reading fixed-asset fields; a vehicle may point to its
 * fixed asset.
 */
export const fleetVehicles = pgTable('fleet_vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  assetId: uuid('asset_id').references(() => fixedAssets.id, { onDelete: 'set null' }),
  plate: text('plate').notNull(),
  name: text('name'),
  /** Trailer (freight): listed as trailer, never as a vehicle to drive. */
  trailer: boolean('trailer').notNull().default(false),
  active: boolean('active').notNull().default(true),
  /** Rent-a-car: offered for rent, class, prices incl. VAT, deposit, km included per day, price per extra km. */
  rent: boolean('rent').notNull().default(false),
  rClass: text('r_class'),
  rDay: money('r_day'), rWeek: money('r_week'), rDep: money('r_dep'), rKm: integer('r_km'), rKmX: money('r_km_x'),
  odo: integer('odo'),
  fuelNorm: numeric('fuel_norm', { precision: 8, scale: 2 }),
  capKg: integer('cap_kg'),
  oilEvery: integer('oil_every'), oilLastKm: integer('oil_last_km'), tyreEvery: integer('tyre_every'), tyreLastKm: integer('tyre_last_km'),
  regExp: date('reg_exp'), insExp: date('ins_exp'), techExp: date('tech_exp'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('fleet_vehicles_plate_uq').on(t.firmId, sql`upper(${t.plate})`),
]);

/* ---------------- Hotel ---------------- */

export const hotelRooms = pgTable('hotel_rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  no: text('no').notNull(),
  kind: text('kind'),
  beds: integer('beds').notNull().default(2),
  floor: text('floor'),
  /** Price per night incl. VAT. */
  price: money('price').notNull().default('0'),
  active: boolean('active').notNull().default(true),
  /** Housekeeping: `dirty` after a check-out. */
  hk: text('hk'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('hotel_rooms_no_uq').on(t.firmId, t.no)]);

export interface HotelGuestRow { name: string; birth?: string; nat?: string; doc?: string; docNo?: string; sex?: string; police?: string }
export interface HotelChargeRow { date: string; name: string; itemId?: string | null; qty: number; price: number; rate: number; konto?: string | null }

/** Legacy `docs` type `hres`. Dates: `from` = arrival, `to` = departure (nights = to − from). */
export const hotelReservations = pgTable('hotel_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  number: text('number').notNull(),
  date: date('date').notNull(),
  roomId: uuid('room_id').notNull().references(() => hotelRooms.id, { onDelete: 'restrict' }),
  from: date('from').notNull(),
  to: date('to').notNull(),
  guestName: text('guest_name').notNull(),
  phone: text('phone'), email: text('email'),
  adults: integer('adults').notNull().default(1),
  children: integer('children').notNull().default(0),
  /** Price per night incl. VAT. */
  price: money('price').notNull().default('0'),
  board: text('board').notNull().default('BB'),
  /** Company paying (invoice partner). */
  partnerId: partnerFk(),
  src: text('src'),
  /** Advance / deposit incl. VAT (invoiced as a Phase 3 advance invoice, deducted on the final invoice). */
  advance: money('advance'),
  guests: jsonb('guests').$type<HotelGuestRow[]>().notNull().default([]),
  charges: jsonb('charges').$type<HotelChargeRow[]>().notNull().default([]),
  status: text('status').$type<'resv' | 'in' | 'out' | 'noshow' | 'cancel'>().notNull().default('resv'),
  note: text('note'),
  noTax: boolean('no_tax').notNull().default(false),
  inAt: ts('in_at'), outAt: ts('out_at'),
  /** Paid at the fiscal till (revenue comes through the Z report) instead of an invoice. */
  folioAt: ts('folio_at'),
  invoiceId: invoiceFk(),
  advanceInvoiceId: invoiceFk('advance_invoice_id'),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('hotel_res_firm_from_idx').on(t.firmId, t.from),
  index('hotel_res_room_idx').on(t.roomId, t.from),
  uniqueIndex('hotel_res_number_uq').on(t.firmId, t.number),
  check('hotel_res_dates_chk', sql`${t.to} > ${t.from}`),
  check('hotel_res_status_chk', sql`${t.status} in ('resv','in','out','noshow','cancel')`),
]);

/* ---------------- Rent-a-car ---------------- */

export interface RentDriver {
  name: string; birth?: string; addr?: string; doc?: string; docType?: string; docExp?: string; docIss?: string; lic?: string; licFrom?: string;
  licExp?: string; licCat?: string; phone?: string; email?: string; nat?: string; embg?: string; emerg?: string;
}
export interface RentHandover { km?: number | string | null; fuel?: number | string | null; dmg?: string; at?: string | null }

/** Legacy `docs` type `rres`. `from` / `to` are local date-times `YYYY-MM-DDTHH:mm`. */
export const rentRentals = pgTable('rent_rentals', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  number: text('number').notNull(),
  date: date('date').notNull(),
  vehicleId: uuid('vehicle_id').notNull().references(() => fleetVehicles.id, { onDelete: 'restrict' }),
  plate: text('plate').notNull(),
  from: text('from').notNull(),
  to: text('to').notNull(),
  driver: jsonb('driver').$type<RentDriver>().notNull().default({ name: '' }),
  driver2: text('driver2'),
  partnerId: partnerFk(),
  deposit: money('deposit'),
  extras: jsonb('extras').$type<{ name: string; qty: number; price: number }[]>().notNull().default([]),
  status: text('status').$type<'resv' | 'out' | 'ret' | 'cancel'>().notNull().default('resv'),
  note: text('note'),
  out: jsonb('out').$type<RentHandover>().notNull().default({ fuel: 8 }),
  ret: jsonb('ret').$type<RentHandover>().notNull().default({}),
  /** Agreed price per day incl. VAT (legacy `pDay`), or agreed total (`priceTot`). */
  pDay: money('p_day'),
  priceTot: money('price_tot'),
  countries: jsonb('countries').$type<string[]>().notNull().default(['MK']),
  green: boolean('green').notNull().default(false),
  invoiceId: invoiceFk(),
  /** Deposit received (cash receipt on the deposits konto) and its settlement. */
  depositVoucherId: voucherFk('deposit_voucher_id'),
  depositPartnerId: partnerFk('deposit_partner_id'),
  depositKept: money('deposit_kept'),
  depositReturnVoucherId: voucherFk('deposit_return_voucher_id'),
  depositClosed: boolean('deposit_closed').notNull().default(false),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('rent_rentals_vehicle_idx').on(t.vehicleId, t.from),
  uniqueIndex('rent_rentals_number_uq').on(t.firmId, t.number),
  check('rent_rentals_status_chk', sql`${t.status} in ('resv','out','ret','cancel')`),
]);

/* ---------------- Travel agency ---------------- */

export interface ArrangementCostRow { cat: string; who?: string; desc?: string; amt?: number | string; cur?: string; fx?: number | string; purchaseId?: string | null }

/** Legacy `docs` type `tarr`. */
export const travelArrangements = pgTable('travel_arrangements', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  code: text('code').notNull(),
  date: date('date').notNull(),
  name: text('name').notNull(),
  dest: text('dest'),
  countries: jsonb('countries').$type<string[]>().notNull().default([]),
  from: date('from'), to: date('to'),
  /** `own` = tour operator (margin scheme, чл. 38), `agent` = intermediary (commission). */
  kind: text('kind').$type<'own' | 'agent'>().notNull().default('own'),
  seats: integer('seats'),
  price: money('price'), priceCh: money('price_ch'),
  comm: numeric('comm', { precision: 6, scale: 2 }),
  prog: text('prog'), incl: text('incl'), excl: text('excl'),
  costs: jsonb('costs').$type<ArrangementCostRow[]>().notNull().default([]),
  status: text('status').$type<'open' | 'full' | 'done' | 'cancel'>().notNull().default('open'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('travel_arr_code_uq').on(t.firmId, t.code), check('travel_arr_kind_chk', sql`${t.kind} in ('own','agent')`)]);

export interface BookingPayRow { date: string; amt: number; how: string; voucherId?: string | null; no?: string | null }

/** Legacy `docs` type `tbook`. */
export const travelBookings = pgTable('travel_bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  arrangementId: uuid('arrangement_id').notNull().references(() => travelArrangements.id, { onDelete: 'restrict' }),
  number: text('number').notNull(),
  date: date('date').notNull(),
  client: jsonb('client').$type<{ name: string; phone?: string; email?: string; addr?: string }>().notNull(),
  partnerId: partnerFk(),
  adults: integer('adults').notNull().default(1),
  children: integer('children').notNull().default(0),
  extra: money('extra'), disc: money('disc'), priceTot: money('price_tot'),
  pax: jsonb('pax').$type<{ name: string; birth?: string; nat?: string; doc?: string; docExp?: string }[]>().notNull().default([]),
  pays: jsonb('pays').$type<BookingPayRow[]>().notNull().default([]),
  room: text('room'), note: text('note'),
  status: text('status').$type<'resv' | 'cancel'>().notNull().default('resv'),
  /** Partner the payments (advances) were booked on. */
  payPartnerId: partnerFk('pay_partner_id'),
  invoiceId: invoiceFk(),
  /** Advance offset against the invoice (journal `tadv`). */
  advanceSettled: money('advance_settled'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('travel_bookings_arr_idx').on(t.arrangementId), uniqueIndex('travel_bookings_number_uq').on(t.firmId, t.number)]);

/* ---------------- Construction ---------------- */

export interface BoqRow { pos?: string; desc: string; unit?: string; qty: number; price: number }

/** Legacy `docs` type `cproj`. */
export const constructionProjects = pgTable('construction_projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  site: text('site'), city: text('city'),
  investorId: partnerFk('investor_id').notNull(),
  cno: text('cno'), cdate: date('cdate'), start: date('start'), end: date('end'),
  nadzor: text('nadzor'), eng: text('eng'),
  /** Reverse charge (чл. 32-а): situation invoices without VAT. */
  art32: boolean('art32').notNull().default(false),
  boq: jsonb('boq').$type<BoqRow[]>().notNull().default([]),
  status: text('status').$type<'open' | 'done'>().notNull().default('open'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('construction_projects_code_uq').on(t.firmId, t.code)]);

/** Legacy `docs` type `csit`: cumulative executed quantity per BOQ line index. */
export const constructionSituations = pgTable('construction_situations', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  projectId: uuid('project_id').notNull().references(() => constructionProjects.id, { onDelete: 'restrict' }),
  no: text('no').notNull(),
  kind: text('kind').$type<'int' | 'fin'>().notNull().default('int'),
  date: date('date').notNull(),
  from: date('from'), to: date('to'),
  cum: jsonb('cum').$type<Record<string, number>>().notNull().default({}),
  invoiceId: invoiceFk(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('construction_sit_project_idx').on(t.projectId, t.date), uniqueIndex('construction_sit_no_uq').on(t.projectId, t.no)]);

/** Legacy `docs` type `cdiary` (градежен дневник). Photos are `file_links` (`construction_diary`). */
export const constructionDiary = pgTable('construction_diary', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  projectId: uuid('project_id').notNull().references(() => constructionProjects.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  weather: text('weather'), temp: text('temp'),
  works: text('works'), mat: text('mat'), issues: text('issues'), nadzor: text('nadzor'),
  workers: jsonb('workers').$type<{ emp: string; name: string; hrs: number; rate: number }[]>().notNull().default([]),
  mach: jsonb('mach').$type<{ name: string; hrs: number; rate: number }[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('construction_diary_project_idx').on(t.projectId, t.date)]);

/**
 * Costs linked to a project (legacy `proj` field written into purchases and cash vouchers). A document belongs to at
 * most one project. FIX: legacy re-saved the purchase itself (re-running every save wrapper) just to tag it.
 */
export const constructionCostLinks = pgTable('construction_cost_links', {
  firmId: firmFk(),
  projectId: uuid('project_id').notNull().references(() => constructionProjects.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').$type<'purchase' | 'cash_voucher'>().notNull(),
  sourceId: uuid('source_id').notNull(),
}, (t) => [primaryKey({ columns: [t.sourceType, t.sourceId] }), index('construction_cost_project_idx').on(t.projectId)]);

/* ---------------- Appointments ---------------- */

/** Legacy `docs` type `appt`. Client notes (`cnote`) are `firm_docs`. */
export const appointments = pgTable('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  date: date('date').notNull(),
  time: text('time').notNull(),
  dur: integer('dur').notNull().default(30),
  /** Resource id (`settings.industry.appt.res[].id` or an employee id). */
  res: text('res').notNull(),
  partnerId: partnerFk(),
  client: text('client'), phone: text('phone'), email: text('email'),
  svc: text('svc'),
  itemId: uuid('item_id'),
  /** Price incl. VAT. */
  price: money('price'),
  status: text('status').$type<'booked' | 'arrived' | 'done' | 'noshow' | 'cancel'>().notNull().default('booked'),
  note: text('note'),
  remindAt: ts('remind_at'),
  invoiceId: invoiceFk(),
  /** Paid at the till: the POS day (`sales_daily`) it went into. */
  salesDayId: uuid('sales_day_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('appointments_firm_date_idx').on(t.firmId, t.date, t.res)]);

/* ---------------- Transport ---------------- */

/**
 * Travel orders (патни налози). Legacy stored them office-wide in `pnal/{id}` with a `fid` field and — because of
 * the `pnSave` collision — actually wrote them into the firm's payroll notes. Stops and events are JSON documents
 * (`@wise/core` `TravelStop`, `TravelEvent`).
 */
export const travelOrders = pgTable('travel_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  number: text('number').notNull(),
  date: date('date').notNull(),
  vehicleId: uuid('vehicle_id').references(() => fleetVehicles.id, { onDelete: 'set null' }),
  plate: text('plate'), vname: text('vname'),
  driverId: uuid('driver_id').references(() => employees.id, { onDelete: 'set null' }),
  driver: text('driver'), codriver: text('codriver'),
  from: text('from'), purpose: text('purpose'),
  stops: jsonb('stops').$type<Record<string, unknown>[]>().notNull().default([]),
  depKm: integer('dep_km'), retKm: integer('ret_km'),
  fuelL: numeric('fuel_l', { precision: 10, scale: 2 }), fuelAmt: money('fuel_amt'),
  /** Field user (role `teren`) who drives it on the phone (`mojpn`). */
  assigneeId: by('assignee_id'),
  dnev: boolean('dnev').notNull().default(false),
  status: text('status').$type<'open' | 'onroad' | 'done'>().notNull().default('open'),
  events: jsonb('events').$type<Record<string, unknown>[]>().notNull().default([]),
  createdBy: by('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('travel_orders_firm_date_idx').on(t.firmId, t.date),
  uniqueIndex('travel_orders_number_uq').on(t.firmId, sql`extract(year from ${t.date})`, t.number),
  check('travel_orders_status_chk', sql`${t.status} in ('open','onroad','done')`),
]);

/** Legacy `docs` type `frt` (v469): a freight tour for a third party (CMR). */
export const freightTours = pgTable('freight_tours', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  number: text('number').notNull(),
  date: date('date').notNull(),
  status: text('status').$type<'plan' | 'road' | 'done' | 'inv' | 'cancel'>().notNull().default('plan'),
  partnerId: partnerFk(),
  orderNo: text('order_no'),
  km: integer('km'),
  vehicleId: uuid('vehicle_id').references(() => fleetVehicles.id, { onDelete: 'set null' }),
  trailer: text('trailer'),
  driverId: uuid('driver_id').references(() => employees.id, { onDelete: 'set null' }),
  driver2Id: uuid('driver2_id').references(() => employees.id, { onDelete: 'set null' }),
  loadPlace: text('load_place'), loadC: text('load_c'), sender: text('sender'),
  unloadDate: date('unload_date'), unloadPlace: text('unload_place'), unloadC: text('unload_c'), consignee: text('consignee'),
  /** Return to base (closes the fuel-card window, FIX 10.4 item 14). */
  retDate: date('ret_date'),
  goods: text('goods'), packages: text('packages'), kg: numeric('kg', { precision: 12, scale: 2 }), m3: numeric('m3', { precision: 12, scale: 2 }),
  adr: text('adr'), docsAtt: text('docs_att'),
  price: money('price'), cur: text('cur').notNull().default('EUR'), fx: numeric('fx', { precision: 18, scale: 6 }),
  /** `intl` (international, 0%) or `dom` (domestic, 18%). */
  vat: text('vat').$type<'intl' | 'dom'>().notNull().default('intl'),
  /** Per-diem reduction % (100 / 50 / 20). */
  red: integer('red').notNull().default(100),
  tolls: money('tolls'), tollCur: text('toll_cur'), otherCost: money('other_cost'),
  note: text('note'),
  segs: jsonb('segs').$type<{ c: string; in: string; out: string; units?: number | string | null }[]>().notNull().default([]),
  invoiceId: invoiceFk(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('freight_tours_firm_date_idx').on(t.firmId, t.date), uniqueIndex('freight_tours_number_uq').on(t.firmId, t.number)]);

export type FleetVehicle = typeof fleetVehicles.$inferSelect;
export type HotelRoom = typeof hotelRooms.$inferSelect;
export type HotelReservation = typeof hotelReservations.$inferSelect;
export type RentRental = typeof rentRentals.$inferSelect;
export type TravelArrangementRow = typeof travelArrangements.$inferSelect;
export type TravelBookingRow = typeof travelBookings.$inferSelect;
export type ConstructionProject = typeof constructionProjects.$inferSelect;
export type ConstructionSituation = typeof constructionSituations.$inferSelect;
export type ConstructionDiaryRow = typeof constructionDiary.$inferSelect;
export type AppointmentRow = typeof appointments.$inferSelect;
export type TravelOrderRow = typeof travelOrders.$inferSelect;
export type FreightTour = typeof freightTours.$inferSelect;
