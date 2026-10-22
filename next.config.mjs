/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: process.env.NEXT_PUBLIC_SUPABASE_URL ? [{
      protocol: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).protocol.replace(":", ""),
      hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
      port: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).port,
      pathname: "/storage/v1/object/public/vote-images/**",
    }] : [],
    imageSizes: [32, 64, 96, 128, 256, 512],
    deviceSizes: [640, 768, 1024, 1280, 1536, 1920],
  },
};

export default nextConfig;
