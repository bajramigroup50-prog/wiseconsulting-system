import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@wise/core', '@wise/db'],
  serverExternalPackages: ['@node-rs/argon2', 'postgres'],
  poweredByHeader: false,
};

export default config;
