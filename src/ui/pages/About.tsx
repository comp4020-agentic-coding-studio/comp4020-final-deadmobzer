import Box from "@mui/material/Box";

// The README, rendered to HTML by marked on the server (src/readme.ts) and shown
// verbatim so its headings survive as text — the spec reads them from here.
export default function About({ html }: { html: string }) {
  return (
    <Box
      className="readme"
      dangerouslySetInnerHTML={{ __html: html }}
      sx={{
        "& h1": { fontSize: "1.9rem", mt: 0, mb: 1.5 },
        "& h2": { fontSize: "1.25rem", mt: 3, mb: 1 },
        "& h3": { fontSize: "1.05rem", mt: 2.5, mb: 0.75 },
        "& p": { color: "text.primary", lineHeight: 1.7 },
        "& a": { color: "primary.main" },
        "& ul, & ol": { pl: 3 },
        "& code": {
          bgcolor: "action.hover",
          px: 0.5,
          py: 0.125,
          borderRadius: 1,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "0.9em",
        },
        "& pre": {
          bgcolor: "action.hover",
          p: 2,
          borderRadius: 2,
          overflowX: "auto",
        },
        "& pre code": { bgcolor: "transparent", p: 0 },
      }}
    />
  );
}
