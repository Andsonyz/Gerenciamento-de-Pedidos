import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["backend/tests/**/*.test.ts", "frontend/tests/**/*.test.ts"],
    testTimeout: 10000,
  },
});
