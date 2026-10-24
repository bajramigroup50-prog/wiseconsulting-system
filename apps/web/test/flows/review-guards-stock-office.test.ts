/**
 * Review (medium) guards: „Провери сега“ is a queued `autopilot` job for `settings`, AML purge is for the office owner only, the
 * office-wide sticker image needs the office-wide `settings` right and an office / own file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const fn = (file: string, name: string) => {
  const m = src(file).match(new RegExp(`export async function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\r?\\n\\}`));
  if (!m) throw new Error(`${name} not found in ${file}`);
  return m[1]!;
};

describe('office-wide actions', () => {
  it('„Провери сега“ needs settings and queues the autopilot job (no full run inside the request)', () => {
    const b = fn('app/(app)/autop/actions.ts', 'runNow');
    expect(b).toMatch(/requireCan\('settings'\)/);
    expect(b).toMatch(/enqueue\('autopilot', \{\}\)/);
    expect(b).not.toMatch(/runAutopilot\(/);
  });

  it('AML purge: the office owner, not any admin', () => {
    const b = fn('app/(app)/aml/ufr-actions.ts', 'amlPurge');
    expect(b).toMatch(/isOfficeOwner\(u\)/);
    expect(b).not.toMatch(/role !== 'admin'/);
  });

  it('sticker image: office-wide settings right, an office file or the user’s own upload', () => {
    for (const n of ['setNoticeImage', 'removeNoticeImage']) {
      const b = fn('app/(app)/klPortal/actions.ts', n);
      expect(b, n).toMatch(/officeGlobal\('settings'\)/);
      expect(b, n).not.toMatch(/officeAction\(/);
    }
    expect(fn('app/(app)/klPortal/actions.ts', 'setNoticeImage')).toMatch(/file\.firmId !== null && file\.by !== u\.id/);
  });
});
