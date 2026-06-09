import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const companionRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Companion is standalone under web/companion; don't infer repo-root lockfile.
  outputFileTracingRoot: companionRoot,
  turbopack: {
    root: companionRoot,
  },
};

export default nextConfig;
