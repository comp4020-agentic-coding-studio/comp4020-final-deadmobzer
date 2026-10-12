import { createRoot } from "react-dom/client";
import App from "../ui/App.tsx";
import type { AppProps } from "../ui/types.ts";

// The server sent lightweight plain HTML (so it stays well under the 256 MB
// machine) plus the initial props here. We render the full Material UI app over
// that placeholder — a client render, not a hydration, since the server markup
// is intentionally simpler than the MUI tree.
declare global {
  interface Window {
    __DATA__?: AppProps;
  }
}

const props = window.__DATA__;
const root = document.getElementById("root");

if (props && root) {
  createRoot(root).render(<App {...props} />);
}
