/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/contest-groups/[groupId]/bracket-image": [
      "./lib/bracket-image/resvg.wasm",
    ],
  },
};

export default nextConfig;
