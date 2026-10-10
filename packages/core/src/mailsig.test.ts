import { describe, expect, it } from 'vitest';
import { MAIL_SIG_MARK, mailSigCfg, mailSigInput, mailSigText, MS_DISC, signMailHtml } from './mailsig';

describe('mail signature (legacy msCfg / msSigText / msHtml)', () => {
  it('defaults to the user name and the confidentiality notice', () => {
    const c = mailSigCfg(null, 'Ана Петрова');
    expect(c).toMatchObject({ greet: 'Со почит,', name: 'Ана Петрова', disc: true, discText: MS_DISC });
    expect(mailSigText(c)).toBe('Со почит,\n\nАна Петрова');
  });
  it('text keeps only filled lines and joins phone and e-mail', () => {
    const c = mailSigCfg({ title: 'Овластен сметководител', phone: '070 123 456', email: 'a@b.mk' }, 'Ана');
    expect(mailSigText(c)).toBe('Со почит,\n\nАна\nОвластен сметководител\nтел. 070 123 456 · a@b.mk');
  });
  it('html is appended once, escaped, notice optional', () => {
    const c = mailSigCfg({ name: 'A <b>' }, '');
    const once = signMailHtml('<p>Здраво</p>', c, '10.10.2026');
    expect(once.startsWith('<p>Здраво</p>' + MAIL_SIG_MARK)).toBe(true);
    expect(once).toContain('A &lt;b&gt;');
    expect(once).toContain('#b3261e');
    expect(signMailHtml(once, c)).toBe(once);
    expect(signMailHtml('x', { ...c, disc: false })).not.toContain('#b3261e');
  });
  it('form input', () => {
    expect(mailSigInput({ greet: ' Поздрав ', disc: 'on', discText: '' })).toMatchObject({ greet: 'Поздрав', disc: true, discText: MS_DISC });
    expect(mailSigInput({}).disc).toBe(false);
  });
});
