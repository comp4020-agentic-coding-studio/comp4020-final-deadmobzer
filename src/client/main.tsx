import { hydrateRoot } from "react-dom/client";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import App from "../ui/App.tsx";
import type { AppProps } from "../ui/types.ts";

// The server left the initial props here and rendered the matching HTML; we
// hydrate the same tree in place rather than re-rendering from scratch.
declare global {
  interface Window {
    __DATA__?: AppProps;
  }
}

const props = window.__DATA__;
const root = document.getElementById("root");

if (props && root) {
  // Match the server's emotion cache key, and point new client-inserted styles at
  // the <head> insertion point so ordering stays consistent with the SSR styles.
  const insertionPoint =
    document.querySelector<HTMLMetaElement>('meta[name="emotion-insertion-point"]') ?? undefined;
  const cache = createCache({ key: "css", insertionPoint });

  hydrateRoot(
    root,
    <CacheProvider value={cache}>
      <App {...props} />
    </CacheProvider>,
  );
}
