import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@resqgrid/api-client"],
  // Lets a production build run next to `next dev` without sharing .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
