import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    // Core and server code is plain TypeScript. Component tests opt in to the
    // DOM with a `// @vitest-environment jsdom` docblock.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "evals/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
