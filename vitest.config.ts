import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Tests run every module's init(); this keeps them off the real global memories in ~/.pi/agent/memories/.
    env: { PI_CODING_AGENT_DIR: "/nonexistent/mypi-test-agent-dir" },
    coverage: {
      provider: "v8",
      include: ["index.ts", "src/**/*.ts"],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
