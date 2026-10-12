import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import type { Friend, PendingRequest } from "../types.ts";
import { card } from "../surface.ts";

// The social surface, now its own screen rather than a sidebar. `friends` and
// `incoming` are kept live by the client (WebSocket → /api/state refetch); on
// the server they render straight from the request's data.
export default function Friends({
  friends,
  incoming,
  flash,
}: {
  friends: Friend[];
  incoming: PendingRequest[];
  flash?: string;
}) {
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Friends</Typography>

      {flash ? <Alert severity="info">{flash}</Alert> : null}

      {incoming.length ? (
        <Box>
          <Typography variant="h3" color="text.secondary" gutterBottom>
            Friend requests
          </Typography>
          <Stack spacing={1.5}>
            {incoming.map((r) => (
              <Box
                key={r.friendship_id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                  flexWrap: "wrap",
                }}
              >
                <Typography>
                  {r.display_name}{" "}
                  <Typography component="span" color="text.secondary">
                    @{r.username}
                  </Typography>
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Box component="form" method="post" action="/friends/accept">
                    <input type="hidden" name="friendship_id" value={r.friendship_id} />
                    <Button type="submit" size="small" variant="contained">
                      accept
                    </Button>
                  </Box>
                  <Box component="form" method="post" action="/friends/decline">
                    <input type="hidden" name="friendship_id" value={r.friendship_id} />
                    <Button type="submit" size="small" color="inherit">
                      decline
                    </Button>
                  </Box>
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}

      <Box>
        <Typography variant="h3" color="text.secondary" gutterBottom>
          Friends
        </Typography>
        {friends.length ? (
          <Stack spacing={1}>
            {friends.map((f) => (
              <Box key={f.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box
                  title={f.online ? "here now" : "away"}
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: f.online ? "#6fae6f" : "divider",
                    flexShrink: 0,
                  }}
                />
                <Typography>
                  {f.display_name}{" "}
                  <Typography component="span" color="text.secondary">
                    @{f.username}
                  </Typography>
                </Typography>
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography color="text.secondary">
            No friends yet. Add one below — your friend prompt starts once they accept.
          </Typography>
        )}
      </Box>

      <Box component="form" method="post" action="/friends/request" sx={card}>
        <Typography variant="h3" color="text.secondary" gutterBottom>
          Add a friend
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
          <TextField name="username" placeholder="their username" required size="small" />
          <Button type="submit" variant="contained" sx={{ flexShrink: 0 }}>
            Send request
          </Button>
        </Stack>
      </Box>
    </Stack>
  );
}
