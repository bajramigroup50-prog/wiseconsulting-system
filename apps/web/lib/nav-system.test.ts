import { describe, expect, it } from 'vitest';
import { sysLabel, sysViewAllowed } from './nav-system';

describe('codebook sub-screens (reachable from „Сите шифрарници“)', () => {
  it('inherit the sifrarnik permission', () => {
    for (const v of ['cb_store', 'cb_warehouse', 'tarifi', 'terkovi', 'cb_city']) expect(sysViewAllowed('acc', v)).toBe(true);
    expect(sysViewAllowed('klient', 'cb_store')).toBe(false);
    expect(sysViewAllowed('teren', 'tarifi')).toBe(false);
    expect(sysViewAllowed('acc', 'nepostoi')).toBe(false);
  });
  it('labels: menu label first, then the codebook title', () => {
    expect(sysLabel('cb_city')).toBe('Шифрарник на градови');
    expect(sysLabel('cb_store')).toBe('Продавници');
  });
});
