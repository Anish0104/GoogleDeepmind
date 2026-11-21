import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Video chunks from the phones can be large.
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
