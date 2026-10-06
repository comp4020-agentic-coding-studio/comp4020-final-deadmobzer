import { readFileSync } from "node:fs";
import { marked } from "marked";

// The brief requires README.md to be published in full at /readme/. We render it
// once at boot and cache the HTML. The spec checks the headings appear in order
// in what the server sends, so a faithful render is all that's needed.
let cached: string | null = null;

function page(bodyHtml: string): string {
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>About this diary</title>
    <link rel="stylesheet" href="/static/style.css" />
  </head>
  <body class="readme">
    <main class="paper">
      <p><a href="/">← back to the diary</a></p>
      ${bodyHtml}
    </main>
  </body>
</html>`;
}

export function renderReadme(): string {
  if (cached === null) {
    const md = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    cached = page(marked.parse(md, { async: false }) as string);
  }
  return cached;
}
