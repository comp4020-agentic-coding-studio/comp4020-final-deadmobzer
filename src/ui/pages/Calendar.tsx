import type { MouseEvent } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import Chip from "@mui/material/Chip";
import type { PageData } from "../types.ts";

type CalData = Extract<PageData, { route: "calendar" }>;

export default function Calendar({
  data,
  onNavigate,
}: {
  data: CalData;
  onNavigate?: (path: string) => void;
}) {
  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h1" gutterBottom>
          Your calendar
        </Typography>
        <Typography color="text.secondary">Every day you've written, newest first.</Typography>
      </Box>

      {data.days.length ? (
        <Stack spacing={1.25}>
          {data.days.map((d) => {
            // Keep this exact href shape: the spec reads the day from it.
            const href = `/day?d=${d.day}`;
            return (
              <Box key={d.day} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Link
                  href={href}
                  underline="hover"
                  color="primary"
                  onClick={(e: MouseEvent) => {
                    if (onNavigate) {
                      e.preventDefault();
                      onNavigate(href);
                    }
                  }}
                >
                  {d.day}
                </Link>
                {d.has_note ? (
                  <Chip size="small" label="a note for you" sx={{ bgcolor: "action.hover" }} />
                ) : null}
              </Box>
            );
          })}
        </Stack>
      ) : (
        <Typography color="text.secondary">
          No entries yet — your reflections will gather here.
        </Typography>
      )}
    </Stack>
  );
}
