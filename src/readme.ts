import { readFileSync } from "node:fs";
import { marked } from "marked";

// The brief requires README.md to be published in full at /readme/. We render it
// to HTML once at boot and cache it; the page shell (src/ui) wraps this body so
// the spec still finds every heading, in order, in what the server sends.
let cached: string | null = null;

export function readmeBodyHtml(): string {
  if (cached === null) {
    const md = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    cached = marked.parse(md, { async: false }) as string;
  }
  return cached;
}
