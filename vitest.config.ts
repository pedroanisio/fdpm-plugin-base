import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Type-only: every declaration is erased at compile time, so the file
      // contributes no executable lines and reports 0% of nothing.
      exclude: ["src/host-contract.ts"],
      // A profile is mostly declarative data; the executable surface is
      // validators, the exporter and the assembly in profile.ts. The floor
      // is the library floor and applies to branches, which is where a
      // validator's failure paths live.
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
    },
  },
});
