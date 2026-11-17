import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./db";
import { sourcePicks } from "./db/schema";
import type { TitleTarget } from "./catalog/ref";
import type { Candidate } from "./sources/resolver";

/** What a pick says about the copies a person wants of the rest of a show. */
export interface PickTraits {
  resolution?: number;
  source?: string;
  hdr?: string;
  videoCodec?: string;
}

/**
 * The pick Play should go back to, for `chooseFile`: the exact copy played of this title,
 * else (an episode) the traits of the copy played of the show most recently. `chosen` is
 * set to the candidate it led to, so the answer can say the copy was remembered.
 */
export interface RememberedPick {
  candidateId?: string;
  traits?: PickTraits;
  chosen?: string;
}

const traitsOf = (c: Pick<Candidate, "resolution" | "source" | "hdr" | "videoCodec">): PickTraits => ({
  resolution: c.resolution,
  source: c.source?.toLowerCase(),
  hdr: c.hdr?.toLowerCase() || undefined,
  videoCodec: c.videoCodec?.toLowerCase(),
});

/** How alike a copy is to `traits`: 0 when the resolution differs (not a match at all). */
export function matchScore(traits: PickTraits, c: Candidate): number {
  const other = traitsOf(c);
  if (traits.resolution === undefined || traits.resolution !== other.resolution) return 0;
  return 1 + (traits.source === other.source ? 4 : 0) + (traits.hdr === other.hdr ? 2 : 0) + (traits.videoCodec === other.videoCodec ? 1 : 0);
}

/**
 * The remembered copy among `candidates` (the server's order, best first): the exact pick,
 * else the one most like the show's pick (ties keep the server's order). `limit` (a
 * device's height cap) rules out taller copies.
 */
export function rememberedCandidate(pick: RememberedPick, candidates: Candidate[], limit?: number): Candidate | undefined {
  const fits = (c: Candidate) => !limit || (c.resolution !== undefined && c.resolution <= limit);
  if (pick.candidateId) {
    const exact = candidates.find((c) => c.id === pick.candidateId);
    if (exact && fits(exact)) return exact;
  }
  if (!pick.traits) return undefined;
  let best: { c: Candidate; score: number } | undefined;
  for (const c of candidates) {
    if (!fits(c)) continue;
    const score = matchScore(pick.traits, c);
    if (score > (best?.score ?? 0)) best = { c, score };
  }
  return best?.c;
}

/** The copies each person picked, per household (file ids belong to its library). */
export class SourcePicks {
  constructor(private readonly db: Db) {}

  private where(userId: string, organizationId: string, t: TitleTarget) {
    return and(
      eq(sourcePicks.userId, userId),
      eq(sourcePicks.organizationId, organizationId),
      eq(sourcePicks.source, t.source),
      eq(sourcePicks.mediaType, t.mediaType),
      eq(sourcePicks.titleId, t.titleId),
      eq(sourcePicks.season, t.season ?? 0),
      eq(sourcePicks.episode, t.episode ?? 0),
    );
  }

  /** Remembers the library copy played of `target`. */
  async remember(userId: string, organizationId: string, target: TitleTarget, candidate: Candidate) {
    const traits = traitsOf(candidate);
    const values = {
      userId,
      organizationId,
      mediaType: target.mediaType,
      source: target.source,
      titleId: target.titleId,
      season: target.season ?? 0,
      episode: target.episode ?? 0,
      candidateId: candidate.id,
      resolution: traits.resolution ?? null,
      releaseSource: traits.source ?? null,
      hdr: traits.hdr ?? null,
      videoCodec: traits.videoCodec ?? null,
      updatedAt: Date.now(),
    };
    const { userId: _u, organizationId: _o, mediaType: _m, source: _s, titleId: _t, season: _se, episode: _e, ...set } = values;
    await this.db
      .insert(sourcePicks)
      .values(values)
      .onConflictDoUpdate({
        target: [sourcePicks.userId, sourcePicks.organizationId, sourcePicks.source, sourcePicks.mediaType, sourcePicks.titleId, sourcePicks.season, sourcePicks.episode],
        set,
      });
  }

  /** Forgets the pick for `target` (it stopped playing, or its file is gone). */
  async forget(userId: string, organizationId: string, target: TitleTarget) {
    await this.db.delete(sourcePicks).where(this.where(userId, organizationId, target));
  }

  /** The exact copy picked for `target`, if any. */
  async exact(userId: string, organizationId: string, target: TitleTarget): Promise<string | undefined> {
    const [row] = await this.db.select({ id: sourcePicks.candidateId }).from(sourcePicks).where(this.where(userId, organizationId, target));
    return row?.id;
  }

  /** What Play should go back to for `target`; undefined when nothing was picked. */
  async remembered(userId: string, organizationId: string, target: TitleTarget): Promise<RememberedPick | undefined> {
    const candidateId = await this.exact(userId, organizationId, target);
    if (target.mediaType !== "episode") return candidateId ? { candidateId } : undefined;
    // The show's latest pick, for an episode with none of its own.
    const [latest] = await this.db
      .select()
      .from(sourcePicks)
      .where(and(
        eq(sourcePicks.userId, userId),
        eq(sourcePicks.organizationId, organizationId),
        eq(sourcePicks.source, target.source),
        eq(sourcePicks.mediaType, "episode"),
        eq(sourcePicks.titleId, target.titleId),
      ))
      .orderBy(desc(sourcePicks.updatedAt))
      .limit(1);
    const traits: PickTraits | undefined = latest
      ? { resolution: latest.resolution ?? undefined, source: latest.releaseSource ?? undefined, hdr: latest.hdr ?? undefined, videoCodec: latest.videoCodec ?? undefined }
      : undefined;
    if (!candidateId && !traits) return undefined;
    return { candidateId, traits };
  }
}
