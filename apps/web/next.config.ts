import type { NextConfig } from 'next';
import path from 'node:path';
const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  turbopack: { root: path.join(process.cwd(), '../..') },
};
export default nextConfig;
