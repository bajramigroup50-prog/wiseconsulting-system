import { describe, expect, it } from 'vitest';
import {
  waMatch, waParseWebhook, waPhone, waPhones, waPlan, waRateRefusal, waSettingsNorm, waStatusNewer, waTemplatePayload, waWindowOpen,
  type WaKnown, type WaTemplate,
} from './wa';

describe('waPhone', () => {
  it('normalises Macedonian and international numbers to the wa_id form', () => {
    expect(waPhone('070 123 456')).toBe('38970123456');
    expect(waPhone('+389 70 123-456')).toBe('38970123456');
    expect(waPhone('00389 70 123 456')).toBe('38970123456');
    expect(waPhone('38970123456')).toBe('38970123456');
    expect(waPhone('70123456')).toBe('38970123456');
    expect(waPhone('02 3 111 222')).toBe('38923111222');
    expect(waPhone('+49 151 2345 6789')).toBe('4915123456789');
    expect(waPhone('123')).toBe('');
    expect(waPhone(null)).toBe('');
  });
  it('reads several phones of one field', () => {
    expect(waPhones('070 111 222 / 071 333 444; 070 111 222')).toEqual(['38970111222', '38971333444']);
  });
});

describe('waMatch', () => {
  const K: WaKnown[] = [
    { phone: '38970111222', firmId: 'A', how: 'firm', name: 'Фирма А' },
    { phone: '38971333444', firmId: 'B', how: 'contact', name: 'Марко' },
    { phone: '38971333444', firmId: 'C', how: 'partner', name: 'Купувач' },
    { phone: '38972555666', firmId: 'A', how: 'partner', name: 'X' },
    { phone: '38972555666', firmId: 'C', how: 'partner', name: 'Y' },
    { phone: '38975000000', firmId: 'D', how: 'crm', name: 'Lead' },
  ];
  it('finds the firm by its phone, written any way', () => {
    expect(waMatch('+389 70 111 222', K)).toEqual({ firmId: 'A', how: 'firm', name: 'Фирма А' });
  });
  it('a firm contact beats a partner of another firm', () => {
    expect(waMatch('38971333444', K)).toMatchObject({ firmId: 'B', how: 'contact' });
  });
  it('the same rank in two firms is not certain → unassigned with candidates', () => {
    expect(waMatch('38972555666', K)).toEqual({ firmId: null, candidates: ['A', 'C'], name: 'X' });
  });
  it('a phone the office assigned wins over everything', () => {
    expect(waMatch('38972555666', K, { '38972555666': 'C' })).toMatchObject({ firmId: 'C', how: 'learned' });
  });
  it('an unknown phone → unassigned, no candidates', () => {
    expect(waMatch('38978999999', K)).toEqual({ firmId: null, candidates: [], name: null });
    expect(waMatch('38975000000', K)).toMatchObject({ firmId: 'D', how: 'crm' });
  });
});

describe('24-hour window and templates', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const T: WaTemplate[] = [
    { name: 'rok_mk', lang: 'mk', purpose: 'rok', vars: ['firma', 'opis', 'rok'], doc: false },
    { name: 'rok_sq', lang: 'sq', purpose: 'rok', vars: ['firma', 'opis', 'rok'], doc: false },
    { name: 'faktura_mk', lang: 'mk', purpose: 'faktura', vars: ['broj', 'iznos'], doc: true },
  ];
  it('the window is open for 24 hours after the last client message', () => {
    expect(waWindowOpen(new Date('2026-11-20T12:30:00Z'), now)).toBe(true);
    expect(waWindowOpen(new Date('2026-11-20T11:59:00Z'), now)).toBe(false);
    expect(waWindowOpen(null, now)).toBe(false);
  });
  it('inside the window: free text', () => {
    expect(waPlan({ lastIn: new Date('2026-11-21T08:00:00Z'), now, purpose: 'rok', templates: [] })).toEqual({ kind: 'free' });
  });
  it('outside the window: the template of the purpose in the wanted language, variables in order', () => {
    const p = waPlan({ lastIn: null, now, purpose: 'rok', lang: 'sq', templates: T, vars: { firma: 'Фирма А', opis: 'ДДВ-04', rok: '25.11.2026' } });
    expect(p).toEqual({ kind: 'template', tpl: T[1], params: ['Фирма А', 'ДДВ-04', '25.11.2026'] });
  });
  it('outside the window without a template → refused (never free text)', () => {
    const p = waPlan({ lastIn: new Date('2026-11-01T00:00:00Z'), now, purpose: 'opomena', templates: T });
    expect('error' in p && p.error).toMatch(/шаблон/);
  });
  it('a missing variable is refused', () => {
    const p = waPlan({ lastIn: null, now, purpose: 'rok', templates: T, vars: { firma: 'A', opis: '' } });
    expect('error' in p && p.error).toMatch(/Опис/);
  });
  it('a PDF outside the window needs a template with a document header', () => {
    expect(waPlan({ lastIn: null, now, purpose: 'rok', templates: T, vars: { firma: 'A', opis: 'b', rok: 'c' }, hasDoc: true })).toHaveProperty('error');
    expect(waPlan({ lastIn: null, now, purpose: 'faktura', templates: T, vars: { broj: '12/26', iznos: '1.000 ден.' }, hasDoc: true })).toMatchObject({ kind: 'template', tpl: { name: 'faktura_mk' } });
  });
  it('a conversation reply (freeOnly) never falls back to a template', () => {
    expect(waPlan({ lastIn: null, now, purpose: 'rok', templates: T, vars: { firma: 'A', opis: 'b', rok: 'c' }, freeOnly: true })).toHaveProperty('error');
  });
  it('the template payload carries the document header and the body parameters', () => {
    const j = waTemplatePayload('38970111222', T[2]!, ['12/26', '1.000 ден.'], { mediaId: 'M1', filename: 'Faktura.pdf' });
    expect(j.template).toEqual({ name: 'faktura_mk', language: { code: 'mk' }, components: [
      { type: 'header', parameters: [{ type: 'document', document: { id: 'M1', filename: 'Faktura.pdf' } }] },
      { type: 'body', parameters: [{ type: 'text', text: '12/26' }, { type: 'text', text: '1.000 ден.' }] },
    ] });
  });
});

describe('rate limit', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it('per minute and per day', () => {
    const s = { perMinute: 3, perDay: 5 };
    expect(waRateRefusal([ago(10_000), ago(20_000)], s, now)).toBeNull();
    expect(waRateRefusal([ago(10_000), ago(20_000), ago(30_000)], s, now)).toMatch(/минута/);
    expect(waRateRefusal([ago(10_000), ago(20_000)], s, now, 2)).toMatch(/минута/);
    expect(waRateRefusal([ago(2 * 36e5), ago(3 * 36e5), ago(4 * 36e5), ago(5 * 36e5), ago(6 * 36e5)], s, now)).toMatch(/Дневната/);
    expect(waRateRefusal([ago(25 * 36e5), ago(26 * 36e5), ago(27 * 36e5), ago(28 * 36e5), ago(29 * 36e5)], s, now)).toBeNull();
  });
});

describe('webhook body', () => {
  it('reads text, documents, images and statuses', () => {
    const w = waParseWebhook({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '38971204123', phone_number_id: '111' },
      contacts: [{ profile: { name: 'Марко' }, wa_id: '38970111222' }],
      messages: [
        { from: '38970111222', id: 'wamid.1', timestamp: '1763726400', type: 'text', text: { body: 'Здраво' } },
        { from: '38970111222', id: 'wamid.2', timestamp: '1763726460', type: 'document', document: { id: 'MED1', mime_type: 'application/pdf', filename: 'faktura.pdf', caption: 'фактура' } },
        { from: '38970111222', id: 'wamid.3', timestamp: '1763726470', type: 'image', image: { id: 'MED2', mime_type: 'image/jpeg' } },
      ],
      statuses: [{ id: 'wamid.out', status: 'delivered', timestamp: '1763726500', recipient_id: '38970111222' }, { id: 'x', status: 'weird' }],
    } }] }] });
    expect(w.phoneNumberId).toBe('111');
    expect(w.messages.map((m) => [m.waId, m.type, m.text, m.media?.id ?? null, m.name])).toEqual([
      ['wamid.1', 'text', 'Здраво', null, 'Марко'], ['wamid.2', 'document', 'фактура', 'MED1', 'Марко'], ['wamid.3', 'image', null, 'MED2', 'Марко'],
    ]);
    expect(w.messages[1]!.media).toMatchObject({ mime: 'application/pdf', filename: 'faktura.pdf' });
    expect(w.statuses).toEqual([{ waId: 'wamid.out', status: 'delivered', at: new Date(1763726500_000), to: '38970111222', error: null }]);
  });
  it('anything else is ignored', () => {
    expect(waParseWebhook({ object: 'page', entry: [] })).toEqual({ phoneNumberId: null, messages: [], statuses: [] });
    expect(waParseWebhook(null).messages).toEqual([]);
  });
  it('a status never goes back; failed always wins', () => {
    expect(waStatusNewer('read', 'delivered')).toBe(false);
    expect(waStatusNewer('sent', 'read')).toBe(true);
    expect(waStatusNewer('read', 'failed')).toBe(true);
  });
  it('settings: bad templates and limits are dropped', () => {
    const s = waSettingsNorm({ perMinute: 999, templates: [{ name: 'Bad Name' }, { name: 'ok_1', lang: 'sq', purpose: 'opomena', vars: ['iznos', 'nope'] as never, doc: true }] as never });
    expect(s.perMinute).toBe(20);
    expect(s.templates).toEqual([{ name: 'ok_1', lang: 'sq', purpose: 'opomena', vars: ['iznos'], doc: true }]);
    expect(s.on).toBe(false);
  });
});
