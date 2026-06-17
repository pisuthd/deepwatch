import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "s2.coinmarketcap.com",
      },
      {
        protocol: "https",
        hostname: "static.coinall.ltd",
      },
      {
        protocol: "https",
        hostname: "bridge-assets.sui.io",
      },
      {
        protocol: "https",
        hostname: "token-image.suins.io",
      },
    ],
  },
};

export default nextConfig;
