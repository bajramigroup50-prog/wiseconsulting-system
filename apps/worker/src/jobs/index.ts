import type { JobDef } from '../job';
import { maintenance } from './maintenance';
import { autopilot } from './autopilot';
import { recurring } from './recurring';
import { remindersJob } from './reminders';
import { pdfRender } from './pdf';

/** Registry: one line per job. */
export const JOBS: JobDef<any>[] = [
  maintenance,
  autopilot,
  recurring,
  remindersJob,
  pdfRender,
];
