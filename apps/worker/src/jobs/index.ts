import type { JobDef } from '../job';
import { maintenance } from './maintenance';

/** Registry: one line per job. */
export const JOBS: JobDef<any>[] = [
  maintenance,
];
