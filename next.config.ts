import type { NextConfig } from "next";

const config: NextConfig = {
  // A production verification build must not overwrite a running demo server's
  // development manifests. Normal dev/build/start continue to use .next.
  distDir: process.env.ED_BUILD_DIR || ".next",
};
export default config;
