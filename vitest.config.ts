import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the running app, which spec/global-setup.ts
// finds. Only spec/ runs: a test anywhere else needs adding to `include`.
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    // One worker per file hammers the running app's single SQLite connection
    // with enough concurrent load to trigger a better-sqlite3/Node native
    // teardown race (Statement destructor vs. V8 cleanup hooks) that crashes
    // the whole server process. Serializing files avoids it without touching
    // the app itself.
    fileParallelism: false,
  },
});
