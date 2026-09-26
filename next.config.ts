import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  devIndicators: false,
  // The neutral theme imports lucide-react from its prebuilt dist. Transpiling it
  // lets Next's lucide barrel optimisation apply, instead of compiling all ~1,800
  // icons for every route in dev.
  transpilePackages: ["@astryxdesign/theme-neutral"],
};

export default nextConfig;
