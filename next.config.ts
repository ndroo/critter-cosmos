import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';
const repositoryName =
  process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'critter-cosmos';
const basePath = isGitHubPages ? `/${repositoryName}` : '';

const nextConfig: NextConfig = isGitHubPages
  ? {
      output: 'export',
      basePath,
      assetPrefix: basePath,
      trailingSlash: true,
    }
  : {};

export default nextConfig;
