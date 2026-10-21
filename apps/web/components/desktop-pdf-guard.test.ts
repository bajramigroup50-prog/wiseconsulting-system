import { describe, expect, it } from 'vitest';
import { opensFile } from './desktop-pdf-guard';

const B = 'https://app.wiseconsulting.com.mk/ifac';
describe('desktop: files and PDFs open in their own window', () => {
  it('files, PDFs, prints – yes; downloads and pages – no', () => {
    expect(opensFile('/api/files/abc', B)).toBe(true);
    expect(opensFile('https://files.app.wiseconsulting.com.mk/wise-docs/x.pdf?X-Amz=1', B)).toBe(true);
    expect(opensFile('/print/ifacEl?y=2026', B)).toBe(true);
    expect(opensFile('/docs/a.PDF', B)).toBe(true);
    expect(opensFile('/api/files/abc?dl=1', B)).toBe(false);
    expect(opensFile('/arhiva', B)).toBe(false);
    expect(opensFile('mailto:x@y.mk', B)).toBe(false);
  });
});
