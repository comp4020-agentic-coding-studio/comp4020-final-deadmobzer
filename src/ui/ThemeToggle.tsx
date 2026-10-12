import IconButton from "@mui/material/IconButton";
import type { Mode } from "./types.ts";
import { IconMoon, IconSun } from "./icons.tsx";

// A single corner button. Works once the client has hydrated; on the server it
// renders the right glyph for the current mode so there's no flash.
export default function ThemeToggle({
  mode,
  onToggle,
}: {
  mode: Mode;
  onToggle?: () => void;
}) {
  return (
    <IconButton
      onClick={onToggle}
      aria-label={mode === "dark" ? "switch to light mode" : "switch to dark mode"}
      sx={{ position: "fixed", top: 10, right: 10, zIndex: 1300, color: "text.secondary" }}
    >
      {mode === "dark" ? <IconSun /> : <IconMoon />}
    </IconButton>
  );
}
