// The reveal rule, kept pure and dependency-free so it can be checked in
// isolation: a note written on `entryDay` stays sealed until the viewer's day
// moves past it. Same day → sealed; any later day → open. Days are "YYYY-MM-DD"
// strings, which compare correctly as plain strings.
export function isRevealed(entryDay: string, viewerDay: string): boolean {
  return entryDay < viewerDay;
}
