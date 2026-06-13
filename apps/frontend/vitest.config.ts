import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@edgar-eye/shared": path.resolve(
        dir,
        "../../packages/shared/src/index.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
