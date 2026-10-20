import { describe, expect, it } from 'vitest';
import { errorsCopyText, ignoredError } from './app-errors';
import type { AppError } from './schema/index';

describe('error register helpers', () => {
  it('ignores browser noise and Next control-flow errors (legacy errLog filter)', () => {
    expect(ignoredError('ResizeObserver loop limit exceeded')).toBe(true);
    expect(ignoredError('Script error.')).toBe(true);
    expect(ignoredError('NEXT_REDIRECT')).toBe(true);
    expect(ignoredError("Cannot read properties of undefined (reading 'x')")).toBe(false);
  });
  it('copy text (legacy errCopy)', () => {
    const e = {
      lastAt: new Date('2026-10-10T09:30:00Z'), userName: 'Ана', role: 'acc', firmName: 'Фирма', view: '/nalozi', src: 'render', count: 3,
      msg: 'Пукна', stack: 'Error: Пукна\n at a\n at b',
    } as AppError;
    expect(errorsCopyText([e])).toBe('Грешки во WISE CONSULTING:\n\n1. 2026-10-10 09:30 · Ана (acc) · фирма: Фирма · екран: /nalozi · render · 3×\n   Пукна\n   Error: Пукна\n    at a\n    at b');
  });
});

describe('not errors', () => {
  it('the firm changed in another tab, an old page after a deploy', () => {
    expect(ignoredError('Фирмата е променета во друг прозорец – освежете ја страницата.')).toBe(true);
    expect(ignoredError('Server Action "603e24b156800d0bc628d7f3641eeae8bec311944d" was not found on the server. Read more: …')).toBe(true);
    expect(ignoredError('Failed query: select …')).toBe(false);
  });
});
