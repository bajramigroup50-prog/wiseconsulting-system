import { describe, expect, it } from 'vitest';
import { buildOf, isStaleActionError, READ_STUCK_MS, readStuck, safeAction, STALE_ACTION_MSG, versionChanged } from './version';
import { publicPath } from './route-guard';

describe('new-version check', () => {
  it('differs only when both builds are known', () => {
    expect(versionChanged('abc', 'def')).toBe(true);
    expect(versionChanged('abc', 'abc')).toBe(false);
    expect(versionChanged('abc', ' abc ')).toBe(false);
    expect(versionChanged('dev', 'def')).toBe(false);
    expect(versionChanged('abc', 'dev')).toBe(false);
    expect(versionChanged('abc', null)).toBe(false);
    expect(versionChanged('', 'abc')).toBe(false);
  });
  it('reads the build from the /api/version answer', () => {
    expect(buildOf({ build: 'X1', sha: null })).toBe('X1');
    expect(buildOf({ build: '' })).toBeNull();
    expect(buildOf(null)).toBeNull();
    expect(buildOf('<html>')).toBeNull();
  });
  it('/api/version is reachable for every role (no route-guard 403)', () => {
    expect(publicPath('/api/version')).toBe(true);
  });
});

describe('stale server-action mapping', () => {
  it('recognises the stale-deployment / network errors', () => {
    expect(isStaleActionError(new Error('Failed to find Server Action "7f3a". This request might be from an older or newer deployment.'))).toBe(true);
    expect(isStaleActionError(new Error('An unexpected response was received from the server.'))).toBe(true);
    expect(isStaleActionError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isStaleActionError(new Error('Неважечки податоци.'))).toBe(false);
  });
  it('a thrown action becomes the clear message right away', async () => {
    expect(await safeAction(async () => { throw new Error('Failed to find Server Action "x"'); })).toEqual({ error: STALE_ACTION_MSG });
    expect(await safeAction(async () => { throw new TypeError('Failed to fetch'); })).toEqual({ error: STALE_ACTION_MSG });
    // a stale deployment answering with HTML resolves to nothing usable
    expect(await safeAction(async () => undefined as unknown as { ids: string[] })).toEqual({ error: STALE_ACTION_MSG });
    expect(await safeAction(async () => ({ ids: ['a'] }))).toEqual({ ids: ['a'] });
    expect(await safeAction(async () => ({ error: 'Изберете датотека.' }))).toEqual({ error: 'Изберете датотека.' });
  });
  it('a read pending for 3 minutes is stuck', () => {
    expect(readStuck('reading', 0, READ_STUCK_MS - 1)).toBe(false);
    expect(readStuck('reading', 0, READ_STUCK_MS)).toBe(true);
    expect(readStuck('queued', 0, READ_STUCK_MS + 1)).toBe(true);
    expect(readStuck('error', 0, 1e9)).toBe(false);
    expect(readStuck('done', 0, 1e9)).toBe(false);
  });
});

describe('PDF / export buttons never spin forever', () => {
  it('a hanging export ends with a message after the time limit; a thrown one says why', async () => {
    const { pdfWithTimeout } = await import('./version');
    expect(await pdfWithTimeout(() => new Promise(() => {}), 20)).toMatch(/навреме/);
    expect(await pdfWithTimeout(async () => null)).toBeNull();
    expect(await pdfWithTimeout(async () => 'Фирмата е променета во друг прозорец – освежете ја страницата.')).toMatch(/Фирмата е променета/);
    expect(await pdfWithTimeout(async () => { throw new TypeError('Failed to fetch'); })).toMatch(/постара верзија/);
  });
});
