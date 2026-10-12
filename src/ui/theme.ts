import { createTheme, type Theme } from "@mui/material/styles";
import type { Mode } from "./types.ts";

// One theme, two modes. The brief asks for the content to fill the screen in
// plain white or black, so background and paper are pure #fff / #000 (not MUI's
// tinted defaults) and we lean on spacing and type rather than borders — Paper
// defaults to no elevation, no outline. The warm accent and serif carry over
// from the app's "paper" origins so the mood stays calm, not corporate.
export function buildTheme(mode: Mode): Theme {
  const dark = mode === "dark";
  return createTheme({
    palette: {
      mode,
      background: {
        default: dark ? "#000000" : "#ffffff",
        paper: dark ? "#000000" : "#ffffff",
      },
      primary: { main: dark ? "#d8b98c" : "#8a6d4b" },
      text: {
        primary: dark ? "#ece7df" : "#2b2622",
        secondary: dark ? "#9a938a" : "#6a625a",
      },
      divider: dark ? "rgba(255,255,255,0.10)" : "rgba(43,38,34,0.10)",
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
      h1: { fontSize: "1.9rem", fontWeight: 600, letterSpacing: "0.01em" },
      h2: { fontSize: "1.2rem", fontWeight: 600 },
      h3: {
        fontSize: "0.78rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.09em",
      },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiTextField: { defaultProps: { variant: "filled", fullWidth: true } },
      MuiFilledInput: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            "&::before, &::after": { display: "none" },
          },
        },
      },
    },
  });
}
