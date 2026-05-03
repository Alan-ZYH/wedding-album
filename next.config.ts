import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Required for @ffmpeg ESM packages to be processed correctly
  transpilePackages: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'drive.google.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
}

export default nextConfig
