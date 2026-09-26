/// <reference types="next" />
/// <reference types="next/image-types/global" />

// Minimal ambient used by convex-test module discovery without adding browser-build-tool types.
interface ImportMeta {
  glob(pattern: string): Record<string, () => Promise<unknown>>;
}

declare module "*.css";
