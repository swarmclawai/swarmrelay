import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@swarmrelay/shared'],
};

export default nextConfig;
