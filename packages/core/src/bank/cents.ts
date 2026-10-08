import { r2 } from '../money';

/** Denars (float, legacy) → integer cents (deni). Normalises -0. */
export const toCents = (x: number): number => Math.round(r2(+x || 0) * 100) || 0;
/** Integer cents → denars. */
export const fromCents = (c: number): number => (c || 0) / 100;
