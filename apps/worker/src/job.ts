import type { DB } from '@wise/db';

/** A background job. Modules add their jobs as files under `jobs/` and one line in `jobs/index.ts`. */
export interface JobDef<T = unknown> {
  name: string;
  /** Cron (Europe/Skopje) for recurring jobs. */
  cron?: string;
  run(data: T, ctx: JobCtx): Promise<void>;
}

export interface JobCtx {
  db: DB;
  log: (msg: string) => void;
  /** Enqueue another job (pg-boss `send`); absent in unit tests. */
  send?: (name: string, data: object) => Promise<unknown>;
}

export const defineJob = <T>(j: JobDef<T>): JobDef<T> => j;
