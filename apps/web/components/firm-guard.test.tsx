/**
 * Browser half of the tab guard after a firm switch in the SAME tab („⇄ Промени фирма“: selectFirm, then a soft
 * navigation): the next post must carry the new firm — never the old one (every action would be refused as
 * „Фирмата е променета во друг прозорец“).
 */
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';

const sent: Headers[] = [];
let mod: typeof import('./firm-guard');

beforeAll(async () => {
  const win = {
    location: { href: 'http://wise.test/etr', origin: 'http://wise.test' },
    fetch: async (_i: RequestInfo | URL, init?: RequestInit) => { sent.push(new Headers(init?.headers)); return new Response('{}'); },
  };
  (globalThis as unknown as { window: unknown }).window = win;
  mod = await import('./firm-guard');
});

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const post = async () => { await (globalThis as unknown as { window: { fetch: typeof fetch } }).window.fetch('/api/pdf', { method: 'POST' }); return sent.at(-1)!; };

describe('firm guard after a same-tab switch', () => {
  it('the re-rendered layout (new props) sends the new firm', async () => {
    renderToString(<mod.FirmGuard firm={{ id: A, name: 'А' }} year={2026}><i /></mod.FirmGuard>);
    expect((await post()).get('x-wise-firm')).toBe(A);
    renderToString(<mod.FirmGuard firm={{ id: B, name: 'Б' }} year={2026}><i /></mod.FirmGuard>);
    expect((await post()).get('x-wise-firm')).toBe(B);
  });

  it('the choice counts at once, and a late re-render with the old props does not undo it', async () => {
    renderToString(<mod.FirmGuard firm={{ id: A, name: 'А' }} year={2026}><i /></mod.FirmGuard>);
    mod.noteRendered({ firm: B, year: 2027 });
    expect(mod.renderedNow()).toEqual({ firm: B, year: '2027' });
    renderToString(<mod.FirmGuard firm={{ id: A, name: 'А' }} year={2026}><i /></mod.FirmGuard>);
    const h = await post();
    expect(h.get('x-wise-firm')).toBe(B);
    expect(h.get('x-wise-year')).toBe('2027');
    // GET requests carry nothing
    await (globalThis as unknown as { window: { fetch: typeof fetch } }).window.fetch('/api/firm-now');
    expect(sent.at(-1)!.get('x-wise-firm')).toBeNull();
  });
});
