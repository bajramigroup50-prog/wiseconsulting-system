import type { JobDef } from '../job';
import { maintenance } from './maintenance';
import { mailFlush, mailSend } from './mail';

/** Registry: one line per job. */
export const JOBS: JobDef<any>[] = [
  maintenance,
  mailSend,
  mailFlush,
];
