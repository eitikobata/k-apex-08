/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for the Dockerfile's multi-stage build — without this, the
  // runtime image needs the full node_modules copied in (much larger).
  // Standalone mode traces exactly which files are needed and outputs a
  // minimal server bundle at .next/standalone.
  output: 'standalone',
};

module.exports = nextConfig;
