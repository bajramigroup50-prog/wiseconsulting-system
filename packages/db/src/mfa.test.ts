import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from './audit';
import { base32, mfaBegin, mfaCheck, mfaConfirm, mfaOff, mfaState, totpCode, totpOk } from './mfa';
import * as schema from './schema/index';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: Tx) => Promise<R>) => db.transaction((tx) => f(tx as unknown as Tx));
let uid = '';

beforeAll(async () => {
  process.env.SOCIAL_SECRET ??= 'test-secret-for-mfa-0123456789abcdef';
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  uid = (await db.insert(schema.users).values({ username: 'isra', name: 'Исра', role: 'acc', passwordHash: 'x' }).returning())[0]!.id;
}, 60_000);

describe('TOTP (RFC 6238 test vectors, SHA-1)', () => {
  const S = base32(Buffer.from('12345678901234567890'));
  it('base32 of the RFC secret', () => expect(S).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'));
  it('codes', () => {
    expect(totpCode(S, 59_000)).toBe('287082');
    expect(totpCode(S, 1111111109_000)).toBe('081804');
    expect(totpCode(S, 2000000000_000)).toBe('279037');
  });
  it('accepts one step of drift, not more', () => {
    expect(totpOk(S, '287082', 59_000 + 30_000)).toBe(true);
    expect(totpOk(S, '287082', 59_000 + 90_000)).toBe(false);
    expect(totpOk(S, '12345', 59_000)).toBe(false);
  });
});

describe('setup, login, recovery, off', () => {
  it('works end to end', async () => {
    expect((await mfaState(db as unknown as Tx, uid)).on).toBe(false);
    const secret = await T((tx) => mfaBegin(tx, uid));
    expect(await T((tx) => mfaConfirm(tx, uid, '000000'))).toBeNull();
    const codes = await T((tx) => mfaConfirm(tx, uid, totpCode(secret)));
    expect(codes).toHaveLength(8);
    expect(await mfaState(db as unknown as Tx, uid)).toMatchObject({ on: true, codesLeft: 8 });
    expect(await T((tx) => mfaCheck(tx, uid, totpCode(secret)))).toBe('ok');
    expect(await T((tx) => mfaCheck(tx, uid, '123456'))).toBe(false);
    expect(await T((tx) => mfaCheck(tx, uid, codes![0]!.toLowerCase()))).toBe('recovery');
    expect(await T((tx) => mfaCheck(tx, uid, codes![0]!))).toBe(false); // used up
    expect((await mfaState(db as unknown as Tx, uid)).codesLeft).toBe(7);
    await T((tx) => mfaOff(tx, uid, null));
    expect((await mfaState(db as unknown as Tx, uid)).on).toBe(false);
  });
});
