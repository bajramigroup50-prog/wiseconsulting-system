/** Round to 2 decimals the way legacy `r2` does (half away from zero, with an epsilon for float noise). */
export const r2 = (n: number): number => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;

/** Postgres `numeric` comes back as a string; parse it without losing the 2-decimal contract. */
export const num = (v: string | number | null | undefined): number => (v == null || v === '' ? 0 : r2(Number(v)));
