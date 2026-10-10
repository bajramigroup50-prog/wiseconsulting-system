import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BackupFormatError, mergeBundles, parseBackupFile, parseBackupJson } from '../src/format';
import { readZip } from '../src/zip';
import { fixtureBackup } from './fixture';

const enc = new TextEncoder();

/** A ZIP like legacy `zipStore` (stored) or a re-packed one (deflate). */
function zip(files: { name: string; text: string }[], deflate = false): Uint8Array {
  const parts: Uint8Array[] = [], cen: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const raw = enc.encode(f.text), data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw, nm = enc.encode(f.name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, deflate ? 8 : 0, true); lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, deflate ? 8 : 0, true); ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    cen.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const cs = cen.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  const all = [...parts, ...cen, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

describe('backup formats', () => {
  it('parses a bkpRun file (v1) with all 14 collections', () => {
    const b = parseBackupJson(fixtureBackup(), 'x.json');
    expect(b.firms).toHaveLength(1);
    expect(b.firms[0]!.format).toBe('bkp-v1');
    expect(b.firms[0]!.at).toBe('2026-10-01T08:00:00.000Z');
    expect(b.firms[0]!.data.invoices).toHaveLength(3);
    expect(b.firms[0]!.data.production).toEqual([]);
  });

  it('parses the "Само оваа фирма" export and keeps the firm images', () => {
    const { firm, data } = fixtureBackup();
    const b = parseBackupJson({ firm, exported: '2026-09-01T00:00:00Z', data }, 'one.json');
    expect(b.firms[0]!.format).toBe('firm-json');
    expect(b.firms[0]!.firm.logo).toMatch(/^data:image\/png/);
  });

  it('rejects files that are not legacy backups (legacy message)', () => {
    expect(() => parseBackupJson({ hello: 1 }, 'x.json')).toThrow(BackupFormatError);
    expect(() => parseBackupFile('x.json', enc.encode('{oops'))).toThrow(/не може да се прочита/);
  });

  it('reads stored (legacy zipStore) and deflated ZIP archives of firm files', () => {
    const f1 = fixtureBackup();
    const f2 = { ...fixtureBackup(), firm: { ...fixtureBackup().firm, id: 'other', name: 'Друга' } };
    for (const deflate of [false, true]) {
      const z = zip([{ name: 'ТЕСТ_mf1abc.json', text: JSON.stringify(f1) }, { name: 'Друга_other.json', text: JSON.stringify(f2) }], deflate);
      expect(readZip(z).map((e) => e.name)).toEqual(['ТЕСТ_mf1abc.json', 'Друга_other.json']);
      const b = parseBackupFile('Rezervna_kopija.zip', z);
      expect(b.firms.map((f) => f.firm.id).sort()).toEqual(['mf1abc', 'other']);
    }
  });

  it('merges files: the newest backup of a firm wins, images come from the per-firm export', () => {
    const fx = fixtureBackup();
    const { logo, ...noLogo } = fx.firm;
    void logo;
    const older = parseBackupJson({ firm: fx.firm, exported: '2026-01-01T00:00:00Z', data: fx.data }, 'old.json');
    const newer = parseBackupJson({ ...fx, firm: noLogo }, 'new.json');
    const m = mergeBundles([older, newer]);
    expect(m.firms).toHaveLength(1);
    expect(m.firms[0]!.source).toBe('new.json');
    expect(m.firms[0]!.firm.logo).toMatch(/^data:/);
  });

  it('accepts a full export with users and office settings', () => {
    const fx = fixtureBackup();
    const b = parseBackupJson({ kind: 'wise-legacy-export', v: 1, at: fx.at, appusers: [{ id: 'u1', username: 'ana' }], settings: { 'appsettings/fx': { rows: [] } }, firms: [{ firm: fx.firm, data: fx.data }] }, 'all.json');
    expect(b.users.map((u) => u.username)).toEqual(['ana']);
    expect(Object.keys(b.glob)).toEqual(['appsettings/fx']);
    expect(b.firms[0]!.format).toBe('full-export');
  });

  it('drops records without id and reports duplicate ids', () => {
    const fx = fixtureBackup();
    const b = parseBackupJson({ ...fx, data: { ...fx.data, partners: [{ name: 'x' }, { id: 'a' }, { id: 'a' }], weird: [] } }, 'x.json');
    expect(b.firms[0]!.data.partners).toHaveLength(1);
    expect(b.warnings.join('\n')).toMatch(/без id[\s\S]*двоен id[\s\S]*непозната збирка „weird“/);
  });
});
