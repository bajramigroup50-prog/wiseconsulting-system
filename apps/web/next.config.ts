import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@wise/core', '@wise/db'],
  serverExternalPackages: ['@node-rs/argon2', 'postgres'],
  poweredByHeader: false,
  // Files read inside server actions (bank statements, Excel imports, reconciliation, ЦРСМ XML) are capped at
  // 20 MB by each action; Next's default 1 MB body limit would refuse them first. Large documents go through the
  // presigned upload (`/api/files`, 100 MB cap) instead.
  experimental: { serverActions: { bodySizeLimit: '21mb' } },
};

export default config;
