import { renderToString } from "react-dom/server";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import createEmotionServer from "@emotion/server/create-instance";
import App from "./App.tsx";
import type { AppProps, PageData } from "./types.ts";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleFor(page: PageData): string {
  switch (page.route) {
    case "today":
      return "Today — a small daily";
    case "calendar":
      return "Calendar — a small daily";
    case "day":
      return `${page.day} — a small daily`;
    case "friends":
      return "Friends — a small daily";
    case "about":
      return "About — a small daily";
    case "landing":
      return "a small daily";
  }
}

// Server-render the React + MUI tree to a full HTML document. Emotion's critical
// CSS is extracted into the <head> so the first paint is fully styled; the client
// then hydrates the same tree from window.__DATA__. The matching cache key and
// insertion-point meta keep server and client styles consistent.
export function renderDocument(props: AppProps): string {
  const cache = createCache({ key: "css" });
  const { extractCriticalToChunks, constructStyleTagsFromChunks } = createEmotionServer(cache);

  const appHtml = renderToString(
    <CacheProvider value={cache}>
      <App {...props} />
    </CacheProvider>,
  );
  const styleTags = constructStyleTagsFromChunks(extractCriticalToChunks(appHtml));

  const bg = props.mode === "dark" ? "#000000" : "#ffffff";
  // Escape </script> sequences so serialized data can't break out of the tag.
  const data = JSON.stringify({ user: props.user, mode: props.mode, page: props.page }).replace(
    /</g,
    "\\u003c",
  );

  return `<!doctype html>
<html lang="en-AU" style="color-scheme:${props.mode}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="emotion-insertion-point" content="" />
    <title>${esc(titleFor(props.page))}</title>
    ${styleTags}
  </head>
  <body style="margin:0;background:${bg}">
    <div id="root">${appHtml}</div>
    <script>window.__DATA__=${data}</script>
    <script type="module" src="/static/app.js"></script>
  </body>
</html>`;
}
