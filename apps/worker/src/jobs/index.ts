import type { JobDef } from '../job';
import { maintenance } from './maintenance';
import { mailFlush, mailSend } from './mail';
import { aiReadDocument } from './ai-read-document';
import { aiPing } from './ai-ping';
import { autopilot } from './autopilot';
import { recurring } from './recurring';
import { remindersJob } from './reminders';
import { pdfRender } from './pdf';
import { invoiceMail } from './invoice-mail';
import { pdfMail } from './pdf-mail';
import { mpinRead } from './mpin-read';
import { lawAsk, lawRobot } from './law';
import { lawTexts } from './law-texts';
import { lawCase } from './law-assist';
import { legacyImport } from './legacy-import';
import { firmResh } from './firm-resh';
import { kontrolaAi } from './kontrola-ai';
import { inboxCombine } from './inbox-combine';
import { clientReportSummary } from './client-report-summary';
import { feeDeliver, feeInvoicesJob, nbrmRates, rokoviJob } from './automations';

/** Registry: one line per job. */
export const JOBS: JobDef<any>[] = [
  maintenance,
  mailSend,
  mailFlush,
  aiReadDocument,
  aiPing,
  autopilot,
  recurring,
  remindersJob,
  pdfRender,
  invoiceMail,
  pdfMail,
  mpinRead,
  lawRobot,
  lawAsk,
  lawTexts,
  lawCase,
  legacyImport,
  firmResh,
  kontrolaAi,
  inboxCombine,
  clientReportSummary,
  nbrmRates,
  rokoviJob,
  feeInvoicesJob,
  feeDeliver,
];
