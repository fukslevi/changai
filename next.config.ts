import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  experimental: {
    /**
     * Server Actions cap request bodies at 1MB by default, which rejects any
     * real RFQ deck. Set slightly ABOVE the app's own 15MB check in
     * lib/actions/projects.ts so an oversized file gets our readable error
     * instead of an opaque 413 that surfaces as "Failed to fetch".
     */
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
