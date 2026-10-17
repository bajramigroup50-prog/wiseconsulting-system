/**
 * `<Uvoz>` (UX P6): one input for the scan zones, the statement import (Изводи and the nalog), the archive upload and
 * the МПИН upload — the screens keep their flow (the same files reach the same handler), only the input is shared.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock('@/app/(app)/skan/actions', () => ({ scanStatus: async () => [], startScans: async () => ({}) }));
vi.mock('@/app/(app)/_ai/actions', () => ({ aiReadStatus: async () => [], startAiRead: async () => ({}) }));
vi.mock('@/app/(app)/banka/actions', () => ({ previewImportAction: async () => ({}), previewNalogImportAction: async () => ({}), saveImportAction: async () => ({}), saveNalogImportAction: async () => ({}),
  pendingBankReadsAction: async () => ({ items: [], reading: 0 }), dismissBankReadsAction: async () => ({}), linkStatementAccountAction: async () => ({}), createStatementAccountAction: async () => ({}) }));
vi.mock('@/app/(app)/mpinIn/actions', () => ({ distributeMpinRows: async () => ({}), setMpinFirm: async () => ({}), startMpinRead: async () => ({}) }));

const { Uvoz, uvozSplit } = await import('./uvoz');
const { ScanUpload, SCAN_ACCEPT } = await import('./sales/scan-upload');
const { ImportBox } = await import('@/app/(app)/banka/import-box');
const { UploadField } = await import('./upload-field');
const { MpinUpload } = await import('@/app/(app)/mpinIn/mpin-client');

const f = (name: string, type = '') => ({ name, type });
const inputs = (h: string) => [...h.matchAll(/<input[^>]*type="file"[^>]*>/g)].map((m) => m[0]);

describe('<Uvoz> format filter', () => {
  it('the scan zones take what they took before (PDF, photos, UBL XML), the rest is refused per file', () => {
    const s = uvozSplit([f('a.pdf', 'application/pdf'), f('b.PDF'), f('c.jpg', 'image/jpeg'), f('d.png', 'image/png'), f('e.webp', 'image/webp'), f('ubl.xml', 'text/xml'), f('ubl2.xml'), f('x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')], SCAN_ACCEPT, true);
    expect(s.take.map((x) => x.name)).toEqual(['a.pdf', 'b.PDF', 'c.jpg', 'd.png', 'e.webp', 'ubl.xml', 'ubl2.xml']);
    expect(s.refused).toEqual([{ name: 'x.docx', ok: false, msg: 'форматот (Word) не се прима тука' }]);
  });
  it('no accept = everything is passed on (the statement import decides itself: КБ .301, …)', () => {
    expect(uvozSplit([f('izvod.301'), f('x.bin')], undefined, true).take).toHaveLength(2);
  });
  it('a single-file input takes the first and says so', () => {
    const s = uvozSplit([f('a.pdf'), f('b.pdf')], '.pdf', false);
    expect(s.take.map((x) => x.name)).toEqual(['a.pdf']);
    expect(s.refused[0]!.msg).toMatch(/една датотека/);
  });
  it('renders a drop zone, a keyboard-reachable button and one hidden multi-file input', () => {
    const h = renderToStaticMarkup(<Uvoz label="Повлечете тука" hint="совет" accept=".pdf" onFiles={() => {}} results={[{ name: 'a.pdf', ok: true, msg: 'примено' }]} />);
    expect(h).toContain('class="drop"');
    expect(h).toContain('role="button"');
    expect(h).toContain('tabindex="0"');
    expect(inputs(h)).toHaveLength(1);
    expect(inputs(h)[0]).toMatch(/multiple/);
    expect(h).toMatch(/PDF<\/span> a\.pdf/);
  });
});

describe('the screens use <Uvoz> and keep their flow', () => {
  it('scan zones (skan / vlez / izlez): the small zone, the same accept, photos-as-pages kept', () => {
    const h = renderToStaticMarkup(<ScanUpload firmId="f" opts={{ kind: 'purchase', batchId: null }} small label={<b>Прикачи</b>} autoOpen={{ back: '/vlez' }} batchView="/masovno" />);
    expect(h).toContain('class="drop drop-sm"');
    expect(inputs(h)).toHaveLength(1);
    expect(inputs(h)[0]).toContain(`accept="${SCAN_ACCEPT}"`);
    expect(h).toContain('Фотографиите прикачени заедно се страници');
  });
  it('statement import (Изводи and the nalog): one input, the account select and the preview flow kept', () => {
    for (const nalog of [undefined, { number: '6', chart: [] as [string, string][], partners: [] }]) {
      const h = renderToStaticMarkup(<ImportBox firmId="f" fx={false} defaultAcct="a1" accounts={[{ id: 'a1', label: 'Халк · 270' }]} nalog={nalog} />);
      expect(inputs(h)).toHaveLength(1);
      expect(inputs(h)[0]).toContain('.300');
      expect(h).toContain('Халк · 270');
      expect(h).toContain('Повлечете го изводот тука');
    }
  });
  it('archive / dossier upload field: the button-size zone, the camera button kept', () => {
    const h = renderToStaticMarkup(<UploadField firmId="f" capture accept="image/*,application/pdf" label="📎 Прикачи датотеки (PDF, слики)" />);
    expect(h).toContain('📎 Прикачи датотеки (PDF, слики)');
    expect(h).toContain('capture="environment"');
    expect(inputs(h)).toHaveLength(2);
  });
  it('МПИН upload', () => {
    const h = renderToStaticMarkup(<MpinUpload pending={false} />);
    expect(h).toContain('📎 Прикачи МПИН (PDF / слики)');
    expect(inputs(h)).toHaveLength(1);
  });
});
