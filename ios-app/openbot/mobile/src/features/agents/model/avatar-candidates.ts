import { bloubAvatarProfile } from "@openbot/brand/bloub-avatar";

interface AvatarCandidates {
  namespace: string;
  batch: number;
  seeds: string[];
}

// DS Bot Mobile: the Bridge stores a face as an avatar shape of at most 32 lowercase letters,
// digits and hyphens, so candidate seeds use that form (OpenBot's `agent:avatar:batch:index`
// would be refused). The picker draws the same seed the Bridge saves, so the chosen face is kept.
const SAFE_SEED = /^[a-z][a-z0-9-]{0,31}$/;
function safeNamespace(seed: string): string {
  const clean = seed.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 12).replace(/-+$/, "");
  return clean || "bot";
}

/** Twelve faces: first one per distinct silhouette, then distinct expressions, as OpenBot picks them. */
function candidateSeeds(namespace: string, currentSeed: string, batch: number): string[] {
  const candidates = [currentSeed];
  const first = bloubAvatarProfile(currentSeed, null);
  const shapes = new Set<string>([first.shape]);
  const expressions = new Set<string>([first.expression]);
  const seed = (index: number) => `${namespace}-${batch.toString(36)}-${index.toString(36)}`;
  let index = 1, misses = 0;
  // New silhouettes until a long run finds none, then new expressions up to twelve faces.
  while (misses < 64 && candidates.length < 12) {
    const candidate = seed(index++);
    const profile = bloubAvatarProfile(candidate, null);
    if (shapes.has(profile.shape) || candidates.includes(candidate)) { misses++; continue; }
    misses = 0;
    shapes.add(profile.shape);
    expressions.add(profile.expression);
    candidates.push(candidate);
  }
  for (let tries = 0; candidates.length < 12 && tries < 500; tries++) {
    const candidate = seed(index++);
    const profile = bloubAvatarProfile(candidate, null);
    if (expressions.has(profile.expression) || candidates.includes(candidate)) continue;
    expressions.add(profile.expression);
    candidates.push(candidate);
  }
  return candidates;
}

export function createAvatarCandidates(seed: string, previous?: AvatarCandidates): AvatarCandidates {
  const namespace = previous?.namespace ?? safeNamespace(seed);
  const batch = previous ? previous.batch + 1 : 0;
  return { namespace, batch, seeds: candidateSeeds(namespace, seed, batch) };
}

/** Whether the Bridge accepts this seed as a Bot's avatar shape. */
export const isStorableAvatarSeed = (seed: string) => SAFE_SEED.test(seed);
