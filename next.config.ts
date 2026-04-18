import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Repo root has a minimal package.json (convenience scripts only). Turbopack
  // otherwise treats that folder as the project root and fails to resolve
  // `@import "tailwindcss"` from app node_modules.
  turbopack: {
    root: appDir,
  },
};

export default nextConfig;
