import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "scripts/__tests__/**/*.test.ts",
      "server/__tests__/**/*.test.ts",
      "src/__tests__/**/*.test.ts",
    ],
  },
});
