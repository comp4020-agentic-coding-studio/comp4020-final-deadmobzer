// Build the server bundle (Node ESM, deps external so better-sqlite3 etc. load
// from the production node_modules). The rules/faction JSON is inlined by esbuild.
//
// Backend-first: there is no client bundle yet — the 3D client (Three.js, bundled
// into public/app.js) lands in a later phase. When it does, it is built HERE and
// must stay client-only. The purity check below fails the build if any heavy
// client/3D library ever leaks into the server graph — the lesson the old build
// paid for (server-rendering a heavy UI crash-looped the 256 MB machine).
import { build } from "esbuild";
import { readFileSync } from "node:fs";

await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  outfile: "dist/server.js",
});

// Purity assertion: the server must never import three/anime/cannon/react-dom.
const serverJs = readFileSync("dist/server.js", "utf8");
const forbidden = ["three", "animejs", "cannon-es", "react-dom", "@mui"];
const leaked = forbidden.filter((p) => serverJs.includes(`from"${p}`) || serverJs.includes(`require("${p}`));
if (leaked.length) {
  throw new Error(`server bundle must stay light; these leaked in: ${leaked.join(", ")}`);
}

// The client bundle: the browser app (React + Three.js + anime.js), bundled and
// minified into public/app.js. This is where all the heavy libraries live.
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

console.log("built dist/server.js (light) and public/app.js (client: React + Three.js)");
