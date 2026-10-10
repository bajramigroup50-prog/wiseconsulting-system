/**
 * PWA / app icons: the legacy brand mark (white „W“ on the header green `--bar` #0d5b4b, legacy.css `.brand i`),
 * rendered to PNG with `next/og`. `maskable` is full-bleed with the letter inside the 80 % safe zone.
 */
import { ImageResponse } from 'next/og';

export const PWA_GREEN = '#0d5b4b';

export function pwaIcon(size: number, maskable = false): ImageResponse {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: PWA_GREEN, borderRadius: maskable ? 0 : Math.round(size * 0.22), color: '#ffffff',
        fontSize: Math.round(size * (maskable ? 0.46 : 0.62)), fontWeight: 700, fontFamily: 'sans-serif',
      }}>W</div>
    ),
    { width: size, height: size },
  );
}
