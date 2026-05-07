import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export so the bundle ships inside the Tauri shell as plain HTML/JS.
  // Dynamic route segments are not allowed under this mode — runtime IDs
  // (project, clip) are passed via query params instead.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
