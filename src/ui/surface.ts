import type { Theme } from "@mui/material/styles";

// Cards are distinguished by a barely-there tint, not a border — the brief asks
// for a minimal number of borders. `reveal` is the warmer surface used for the
// "what a friend wrote" moments.
export const card = (t: Theme) => ({
  p: { xs: 2.5, sm: 3 },
  borderRadius: 3,
  bgcolor: t.palette.mode === "dark" ? "rgba(255,255,255,0.045)" : "rgba(43,38,34,0.035)",
});

export const reveal = (t: Theme) => ({
  ...card(t),
  bgcolor: t.palette.mode === "dark" ? "rgba(216,185,140,0.10)" : "rgba(138,109,75,0.08)",
});

export const promptText = { fontStyle: "italic", color: "primary.main", mb: 1.25 } as const;
