import { defineConfig } from "@playwright/test";

// A SEPARATE suite from spec/ (see spec/README.md) and NOT part of `pnpm check`
// (package.json's "check" script is `tsc --noEmit && vitest run`, unchanged by
// this file). Why split them:
//
//   - spec/ talks to the running app over plain HTTP/WS and asserts on JSON —
//     no browser, so a whole run is seconds and every result is deterministic.
//     That's what should gate every commit (`pnpm check`).
//   - e2e/ drives two real headless-Chromium browser contexts through actual
//     sign-up/login/lobby/deploy/combat clicks against a Three.js canvas, with
//     video recording on. That means real navigation, animation waits, and
//     WebGL — tens of seconds per run, and occasionally flaky in a way that
//     has nothing to do with whether the app is correct (a slow paint, a
//     dropped frame during the standee's position lerp in src/three/table.ts).
//     Gating `pnpm check` on that would make the fast, reliable signal noisy.
//
// Run it with `pnpm test:e2e` (see package.json). It needs a dev server
// already running and reachable at E2E_BASE_URL (default
// http://localhost:8080) — it does not start one for you, the same contract
// spec/global-setup.ts uses for APP_URL. Start one locally with a writable
// DATA_DIR, since the default /data (src/db.ts) requires root:
//
//   DATA_DIR=/tmp/maleghast-e2e-data pnpm dev
//
// then, in another shell:
//
//   pnpm test:e2e
//
// Videos land in e2e/test-results/**/video.webm (gitignored) — one per
// browser context, so each of the two "players" gets its own recording of
// what it saw and clicked.
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    headless: true,
    video: "on",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{
    name: "chromium",
    use: {
      browserName: "chromium",
      launchOptions: {
        // The 3D table (src/three/table.ts) needs a working WebGL context.
        // This sandbox has no Vulkan driver available to Chromium's ANGLE
        // backend (confirmed: vk_swiftshader_icd.json -> "Found no
        // drivers!", and ANGLE's own Vulkan init fails with "VK_KHR_surface
        // ... not supported" even headful) so the usual
        // --use-gl=swiftshader software-rasterizer recipe doesn't work
        // here. What *does* work in genuine headless mode is routing ANGLE
        // straight through to the real GPU's Mesa/iris OpenGL driver
        // instead of a software one: --use-angle=gl. --no-sandbox is
        // needed because this environment doesn't have the Chromium
        // sandbox (user namespaces / setuid helper) set up.
        args: ["--use-gl=angle", "--use-angle=gl", "--no-sandbox"],
      },
    },
  }],
});
