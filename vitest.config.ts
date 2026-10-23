import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["index.ts", "src/**/*.ts"],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
