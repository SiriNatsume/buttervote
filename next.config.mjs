/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    config.module.rules.push({
      test: /@resvg[\\/]resvg-wasm[\\/]index_bg\.wasm$/,
      type: "asset/resource",
      generator: {
        filename: "static/wasm/[hash][ext]",
      },
    });

    return config;
  },
};

export default nextConfig;
