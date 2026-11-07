import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@wise/core', '@wise/db'],
  serverExternalPackages: ['@node-rs/argon2', 'postgres', 'pdfjs-dist'],
  poweredByHeader: false,
  // Files read inside server actions (bank statements, Excel imports, reconciliation, ЦРСМ XML, the old program's
  // „Финансов налог“ PDF of a whole year – 900+ pages, 40 MB cap in the action) go in the request body; Next's default
  // limits (1 MB actions, 10 MB buffered through `proxy.ts`) would cut them first. Large documents go through the
  // presigned upload (`/api/files`, 100 MB cap) instead.
  experimental: { serverActions: { bodySizeLimit: '45mb' }, proxyClientMaxBodySize: '45mb' },
};

export default config;
