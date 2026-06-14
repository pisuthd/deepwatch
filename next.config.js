/** @type {import('next').NextConfig} */
const nextConfig = {
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

module.exports = nextConfig;
