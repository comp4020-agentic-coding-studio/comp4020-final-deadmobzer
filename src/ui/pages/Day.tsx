import type { MouseEvent } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import type { PageData } from "../types.ts";
import { card, promptText, reveal } from "../surface.ts";

type DayData = Extract<PageData, { route: "day" }>;

export default function Day({
  data,
  onNavigate,
}: {
  data: DayData;
  onNavigate?: (path: string) => void;
}) {
  return (
    <Stack spacing={3}>
      <Link
        href="/calendar"
        underline="hover"
        color="text.secondary"
        onClick={(e: MouseEvent) => {
          if (onNavigate) {
            e.preventDefault();
            onNavigate("/calendar");
          }
        }}
      >
        ← calendar
      </Link>

      <Typography variant="overline" color="text.secondary">
        {data.day}
      </Typography>

      {data.self ? (
        <Box sx={card}>
          <Typography variant="h2" gutterBottom>
            Your reflection
          </Typography>
          <Typography sx={promptText}>{data.self.prompt_text}</Typography>
          <Typography>{data.self.body}</Typography>
        </Box>
      ) : (
        <Typography color="text.secondary">You didn't write a reflection this day.</Typography>
      )}

      {data.notes.map((n, i) => (
        <Box key={i} sx={reveal}>
          <Typography variant="h2" gutterBottom>
            From {n.author_name}
          </Typography>
          <Typography sx={promptText}>{n.prompt_text}</Typography>
          <Typography>{n.body}</Typography>
        </Box>
      ))}
    </Stack>
  );
}
