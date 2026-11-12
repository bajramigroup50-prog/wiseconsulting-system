import { describe, expect, it } from 'vitest';
import { createPublicKey } from 'node:crypto';
import { newRsaKey } from './feeds';

describe('RSA-4096 key for the banks that accept only ssh-rsa', () => {
  it('is a 4096-bit ssh-rsa public key matching the private key', () => {
    const k = newRsaKey();
    expect(k.pub).toMatch(/^ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQ[A-Za-z0-9+/=]+ WISE-bank$/);
    expect(k.priv).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
    const pub = createPublicKey(k.priv);
    expect(pub.asymmetricKeyDetails?.modulusLength).toBe(4096);
    // the n in the ssh blob is the private key's n
    const b = Buffer.from(k.pub.split(' ')[1]!, 'base64');
    const n = (pub.export({ format: 'jwk' }) as { n: string }).n;
    expect(b.includes(Buffer.from(n, 'base64url'))).toBe(true);
  });
});
