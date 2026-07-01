/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  // Set NEXT_PUBLIC_BASE_PATH=/sentinelgrid to host the demo under a subpath
  // of an existing website.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  images: { unoptimized: true },
};

export default nextConfig;
