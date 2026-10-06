// Maximum bipartite matching by augmenting paths (Kuhn's algorithm). Writers
// and targets are the same set of users; an edge writer→target exists when they
// are friends (and writer ≠ target). The matching assigns each matched writer a
// distinct target, so every matched target is written about exactly once — the
// reciprocity guarantee, as far as the friend graph admits one.
//
// adjacency: writerId -> list of candidate targetIds.
// Returns a Map writerId -> targetId for the writers that got matched.
export function maximumMatching(adjacency: Map<number, number[]>): Map<number, number> {
  const matchTargetToWriter = new Map<number, number>();

  const augment = (writer: number, seen: Set<number>): boolean => {
    for (const target of adjacency.get(writer) ?? []) {
      if (seen.has(target)) continue;
      seen.add(target);
      const current = matchTargetToWriter.get(target);
      if (current === undefined || augment(current, seen)) {
        matchTargetToWriter.set(target, writer);
        return true;
      }
    }
    return false;
  };

  // Deterministic order so a given graph yields a stable matching.
  const writers = [...adjacency.keys()].sort((a, b) => a - b);
  for (const writer of writers) augment(writer, new Set());

  const writerToTarget = new Map<number, number>();
  for (const [target, writer] of matchTargetToWriter) writerToTarget.set(writer, target);
  return writerToTarget;
}
