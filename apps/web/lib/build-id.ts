import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let cached: string | null = null;

/**
 * The Next build id of the running server (`.next/BUILD_ID`, written before static generation, so prerendered
 * pages carry the same id). `dev` under `next dev` / tests: the new-version check is then off.
 */
export function buildId(): string {
  if (cached) return cached;
  let id = '';
  try { id = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim(); } catch { /* dev / tests */ }
  if (process.env.NODE_ENV !== 'production' || !id || id === 'development') id = 'dev';
  return (cached = id);
}

/** The git commit the image was built from (`GIT_SHA` build arg, docker/Dockerfile); informational. */
export const gitSha = (): string | null => process.env.GIT_SHA?.trim() || null;
