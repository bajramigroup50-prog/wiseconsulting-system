import { describe, expect, it } from 'vitest';
import { wordsMatch } from './picker';

describe('firm search: every word, Latin = Cyrillic', () => {
  it('finds a Cyrillic name typed in Latin and the other way round', () => {
    expect(wordsMatch(['БАЈРАМИ ГРОУП ДООЕЛ Скопје'], 'bajrami')).toBe(true);
    expect(wordsMatch(['БАЈРАМИ ГРОУП ДООЕЛ Скопје'], 'bajrami group')).toBe(true);
    expect(wordsMatch(['MEDIA POWER GROUP'], 'медиа')).toBe(true);
    expect(wordsMatch(['МЕДИА ПОВЕР ГРОУП ДООЕЛ', '4085025502990'], '40850')).toBe(true);
    expect(wordsMatch(['МЕДИА ПОВЕР ГРОУП ДООЕЛ'], 'медиа трули')).toBe(false);
    expect(wordsMatch(['ТРУЛИ НОЛЕН'], '')).toBe(true);
  });
});
