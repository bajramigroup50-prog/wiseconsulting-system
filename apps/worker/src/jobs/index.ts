import type { JobDef } from '../job';
import { maintenance } from './maintenance';
import { mailFlush, mailSend } from './mail';
import { aiReadDocument } from './ai-read-document';
import { autopilot } from './autopilot';
import { recurring } from './recurring';
import { remindersJob } from './reminders';
import { pdfRender } from './pdf';
import { invoiceMail } from './invoice-mail';
import { legacyImport } from './legacy-import';

/** Registry: one line per job. */
export const JOBS: JobDef<any>[] = [
  maintenance,
  mailSend,
  mailFlush,
  aiReadDocument,
  autopilot,
  recurring,
  remindersJob,
  pdfRender,
  invoiceMail,
  legacyImport,
];
