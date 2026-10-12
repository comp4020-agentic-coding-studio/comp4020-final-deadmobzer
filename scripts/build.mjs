// Two bundles. The server bundle is Node ESM with react/mui left external (they
// load from the production node_modules at runtime, as before). The client
// bundle is the browser app: react + mui bundled in, minified, built for
// production. It replaces the old hand-written public/app.js.
import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  outfile: "dist/server.js",
});

await build({
  entryPoints: ["src/client/main.tsx"],
  bundle: true,
  platform: "browser",
  target: "es2020",
  format: "esm",
  minify: true,
  sourcemap: false,
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: "public/app.js",
});

console.log("built dist/server.js and public/app.js");
