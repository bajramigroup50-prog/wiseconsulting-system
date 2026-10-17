/**
 * Read result → review drafts. The code lives in `@wise/db` (`sales/scan-drafts.ts`) so the web app can rebuild the
 * drafts of unsaved reads with the current rules („↻ Примени ги правилата повторно“) without the worker.
 */
export { matchData, numberRange, purchaseDrafts, saleDrafts, SCAN_RULES_V, type DraftOpts } from '@wise/db';
