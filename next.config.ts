import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * sharp is a native module - bundling it breaks the binary it loads at
   * runtime, so it is left external like postgres. It downscales supplier
   * photos before they go to the model; vision input is billed by pixel area,
   * and 6MB phone pictures of a price list cost many times what a legible copy
   * of the same page costs.
   */
  serverExternalPackages: ["postgres", "sharp"],
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
