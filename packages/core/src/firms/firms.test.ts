import { describe, expect, it } from 'vitest';
import { MS_DISC, mailSigCfg, mailSigText, signMailHtml } from './mailsig';
import { zsRokRows } from './zsrok';

describe('zsRok', () => {
  it('deadlines fall in the next year, per entity', () => {
    expect(zsRokRows('co', 2025)[0]![2]).toContain('15 март 2026');
    expect(zsRokRows('tp', 2025)).toHaveLength(4);
    expect(zsRokRows('npo', 2025).every((r) => r[3] === 'zsNPO')).toBe(true);
  });
});

describe('mail signature (legacy msCfg / msSigText / msHtml)', () => {
  it('defaults and plain text', () => {
    const c = mailSigCfg(null, 'Ана Петрова');
    expect(c.greet).toBe('Со почит,');
    expect(c.discText).toBe(MS_DISC);
    expect(mailSigText({ ...c, phone: '070', email: 'a@b.mk' })).toBe('Со почит,\n\nАна Петрова\nтел. 070 · a@b.mk');
  });
  it('signs once and escapes', () => {
    const c = mailSigCfg({ name: '<b>X</b>', disc: false });
    const once = signMailHtml('<p>Hi</p>', c, '01.01.2026 10:00');
    expect(once).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(once).not.toContain('НАПОМЕНА');
    expect(signMailHtml(once, c, 'x')).toBe(once);
    expect(signMailHtml('<p>Hi</p>', null, 'x')).toBe('<p>Hi</p>');
  });
});
