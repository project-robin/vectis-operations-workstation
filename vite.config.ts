import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4100",
      },
    },
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
  },
});
