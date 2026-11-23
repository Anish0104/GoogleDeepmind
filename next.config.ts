import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Video chunks from the phones can be large.
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
  // Allow LAN development origins (phones, testing devices)
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.0.231",
    "192.168.1.149",
  ],
};

export default nextConfig;
