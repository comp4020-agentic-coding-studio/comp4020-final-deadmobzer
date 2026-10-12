import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import { card } from "../surface.ts";

// Signed-out entry. Native form POSTs to /login and /signup, exactly as before —
// the server contract (and the "Sign in" text the spec checks) is unchanged.
export default function Landing({ error }: { error?: string }) {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h1" gutterBottom>
          a small daily
        </Typography>
        <Typography color="text.secondary">
          A quiet place to reflect on your day — and to be seen by a friend. Each day you answer one
          prompt for yourself and one about a friend. You read what a friend wrote about you the next
          morning.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Box component="form" method="post" action="/login" sx={card}>
        <Typography variant="h2" gutterBottom>
          Sign in
        </Typography>
        <Stack spacing={2}>
          <TextField name="username" label="Username" autoComplete="username" required />
          <TextField
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
          />
          <Button type="submit" variant="contained">
            Sign in
          </Button>
        </Stack>
      </Box>

      <Box component="form" method="post" action="/signup" sx={card}>
        <Typography variant="h2" gutterBottom>
          New here
        </Typography>
        <Stack spacing={2}>
          <TextField name="username" label="Username" autoComplete="username" required />
          <TextField name="display_name" label="Display name" />
          <TextField
            name="password"
            type="password"
            label="Password"
            autoComplete="new-password"
            required
          />
          <Button type="submit" variant="contained">
            Create account
          </Button>
        </Stack>
      </Box>
    </Stack>
  );
}
