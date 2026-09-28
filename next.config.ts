import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // D64 (brief #5k §1) — every document upload in this app goes
      // through a Server Action, and Next's own default limit (1 MB) is
      // far below a real screenshot or scanned PDF. 25 MB comfortably
      // covers a phone screenshot or a multi-page scanned certificate
      // (the largest document type this app handles) while still
      // bounding a single upload to something the local SQLite/disk setup
      // can absorb without special handling. Confirmed against the
      // installed Next.js version (15.5.23): this key,
      // experimental.serverActions.bodySizeLimit, is still current there
      // (node_modules/next/dist/server/config-schema.js).
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
