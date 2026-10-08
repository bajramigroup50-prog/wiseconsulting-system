import { describe, expect, it } from 'vitest';
import { can, entryStatusFor, firmAllowed, type Principal } from './rbac';

const u = (role: Principal['role'], firms: string[] = ['f1']): Principal => ({ id: 'u1', role, firms });

describe('rbac (legacy RP / ACT_NEED parity)', () => {
  it('admin can do everything on any firm', () => {
    expect(can(u('admin', []), 'nalDel', 'fX')).toBe(true);
    expect(can(u('admin', []), 'uNew')).toBe(true);
  });
  it('senior cannot delete, fix journals or manage users', () => {
    expect(can(u('senior'), 'nalDel', 'f1')).toBe(false);
    expect(can(u('senior'), 'nalEdit', 'f1')).toBe(false);
    expect(can(u('senior'), 'uSave')).toBe(false);
    expect(can(u('senior'), 'closeYear', 'f1')).toBe(true);
  });
  it('acc writes and does office work only', () => {
    expect(can(u('acc'), 'write', 'f1')).toBe(true);
    expect(can(u('acc'), 'tNew', 'f1')).toBe(true);
    expect(can(u('acc'), 'newFirm')).toBe(false);
    expect(can(u('acc'), 'schSave', 'f1')).toBe(false);
  });
  it('view is read-only', () => {
    expect(can(u('view'), 'write', 'f1')).toBe(false);
    expect(can(u('view'), 'anyUnlistedAction', 'f1')).toBe(false);
  });
  it('teren has no accounting access', () => {
    expect(can(u('teren'), 'write', 'f1')).toBe(false);
    expect(can(u('teren'), 'teren')).toBe(true);
  });
  it('firm scoping', () => {
    expect(can(u('acc'), 'write', 'f2')).toBe(false);
    expect(can(u('acc', ['*']), 'write', 'f2')).toBe(true);
    expect(firmAllowed(u('view', []), 'f9', 'u1')).toBe(true);
  });
  it('klient entries are pending', () => {
    expect(can(u('klient'), 'write', 'f1')).toBe(true);
    expect(can(u('klient'), 'nalDel', 'f1')).toBe(false);
    expect(entryStatusFor(u('klient'))).toBe('pending');
    expect(entryStatusFor(u('acc'))).toBe('posted');
  });
});
