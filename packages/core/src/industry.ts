/**
 * Industry modules (Phase 10): hotel, restaurant, rent-a-car, travel agency, transport (travel orders + freight),
 * construction, appointments, and the per-firm module toggle. Pure logic only; persistence is in `@wise/db` `industry/`.
 * Import as `@wise/core/industry` or the `Industry` namespace of `@wise/core`.
 */
export * from './industry/common';
export * from './industry/modules';
export * from './industry/hotel';
export * from './industry/rentacar';
export * from './industry/travel';
export * from './industry/construction';
export * from './industry/appointments';
export * from './industry/restaurant';
export * from './industry/transport';
export * from './industry/auto';
export * from './industry/fuelcard';
export * from './industry/fleetlive';
export * from './industry/auto-parity';
export * from './industry/freight-parity';
export * from './industry/transport-parity';
export * from './industry/hotel-rent-parity';
export * from './industry/other-parity';
