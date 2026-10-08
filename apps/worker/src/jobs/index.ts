import type { JobDef } from '../job';
import { maintenance } from './maintenance';
import { aiReadDocument } from './ai-read-document';

/** Registry: one line per job. */
export const JOBS: JobDef<any>[] = [
  maintenance,
  aiReadDocument,
];
