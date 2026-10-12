import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import type { PageData, SelfEntry } from "../types.ts";
import { card, promptText, reveal } from "../surface.ts";

type TodayData = Extract<PageData, { route: "today" }>;

function PromptForm({
  kind,
  prompt,
  existing,
}: {
  kind: "self" | "friend";
  prompt: string;
  existing: SelfEntry | undefined;
}) {
  return (
    <Box component="form" method="post" action="/entry" sx={card}>
      <input type="hidden" name="kind" value={kind} />
      <Typography sx={promptText}>{prompt}</Typography>
      <TextField
        name="body"
        multiline
        minRows={4}
        placeholder="Write freely…"
        defaultValue={existing ? existing.body : ""}
      />
      <Stack direction="row" sx={{ mt: 1.5, justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary">
          {existing ? "saved — you can refine it until midnight" : ""}
        </Typography>
        <Button type="submit" variant="contained">
          {existing ? "Update" : "Save"}
        </Button>
      </Stack>
    </Box>
  );
}

export default function Today({ data }: { data: TodayData }) {
  const { task, mine, yesterday, todayLabel, flash } = data;

  return (
    <Stack spacing={3}>
      <Typography variant="overline" color="text.secondary">
        {todayLabel}
      </Typography>

      {flash ? <Alert severity="info">{flash}</Alert> : null}

      <Box sx={reveal}>
        <Typography variant="h2" gutterBottom>
          What a friend wrote about you
        </Typography>
        {yesterday.length ? (
          yesterday.map((n, i) => (
            <Box key={i} sx={{ mb: i < yesterday.length - 1 ? 2 : 0 }}>
              <Typography sx={promptText}>{n.prompt_text}</Typography>
              <Typography>{n.body}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                — {n.author_name}, yesterday
              </Typography>
            </Box>
          ))
        ) : (
          <Typography color="text.secondary">
            Nothing from yesterday yet. Notes you've written appear here the next morning.
          </Typography>
        )}
      </Box>

      <Box>
        <Typography variant="h3" color="text.secondary" gutterBottom>
          For yourself
        </Typography>
        <PromptForm kind="self" prompt={task.self_prompt_text} existing={mine.self} />
      </Box>

      <Box>
        <Typography variant="h3" color="text.secondary" gutterBottom>
          For a friend
        </Typography>
        {task.friend_target_id !== null && task.friend_prompt_text ? (
          <PromptForm kind="friend" prompt={task.friend_prompt_text} existing={mine.friend} />
        ) : (
          <Box sx={card}>
            <Typography color="text.secondary">
              No friend prompt today — add a friend and one arrives tomorrow.
            </Typography>
          </Box>
        )}
      </Box>
    </Stack>
  );
}
