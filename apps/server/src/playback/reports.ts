import { and, desc, eq, lt, lte, or } from "drizzle-orm";
import type { Db } from "../db";
import { playReports } from "../db/schema";
import type { TitleTarget } from "../catalog/ref";
import { redactSecrets } from "../log";

/** Reports kept per household, and for how long. */
const KEEP = 300;
const KEEP_MS = 30 * 24 * 60 * 60_000;

/** A file server (TorBox's, say) that a copy's link pointed at, and what happened there. */
export interface PlayReportServer {
  host: string;
  error: string;
}

/** One copy the app tried. */
export interface PlayAttempt {
  fileId?: number;
  /** How the app named it ("2160p · Remux"). */
  copy?: string;
  /** Where it went wrong: "reading" (the file's details), "connecting", "playing"… */
  stage?: string;
  /** The error itself, as the device saw it. Empty when the copy played. */
  error?: string;
  /** File servers it was sent to, in order; earlier ones didn't answer. */
  servers?: PlayReportServer[];
}

export interface PlayReportInput {
  target: TitleTarget;
  outcome: "failed" | "recovered";
  message: string;
  attempts: PlayAttempt[];
  appVersion?: string;
}

export interface PlayReportDevice {
  deviceName: string | null;
  deviceModel: string | null;
  location: string | null;
}

export type PlayReportRow = typeof playReports.$inferSelect;

/**
 * What went wrong with a household's plays, as its apps report it: a play that failed,
 * or one that only started after switching copies or file servers. Its admins read them
 * on the dashboard; nothing here is ever shown to members.
 */
export class PlayReports {
  constructor(
    private readonly db: Db,
    private readonly organizationId: string,
  ) {}

  async record(userId: string, input: PlayReportInput, device: PlayReportDevice): Promise<void> {
    const createdAt = Date.now();
    await this.db.insert(playReports).values({
      organizationId: this.organizationId,
      userId,
      source: input.target.source,
      mediaType: input.target.mediaType,
      titleId: input.target.titleId,
      season: input.target.season ?? null,
      episode: input.target.episode ?? null,
      outcome: input.outcome,
      // Links can carry the TorBox key (`token=`): none of it is kept.
      message: redactSecrets(input.message),
      attemptsJson: JSON.stringify(input.attempts.map(clean)),
      appVersion: input.appVersion ?? null,
      ...device,
      createdAt,
    });
    await this.prune(createdAt);
  }

  /** The newest first. */
  async list(limit = 50): Promise<PlayReportRow[]> {
    return this.db.select().from(playReports).where(eq(playReports.organizationId, this.organizationId)).orderBy(desc(playReports.id)).limit(limit);
  }

  async clear(): Promise<void> {
    await this.db.delete(playReports).where(eq(playReports.organizationId, this.organizationId));
  }

  /** Drops what's older than a month, and all but the newest `KEEP`. */
  private async prune(now: number) {
    const mine = eq(playReports.organizationId, this.organizationId);
    const [cutoff] = await this.db.select({ id: playReports.id }).from(playReports).where(mine).orderBy(desc(playReports.id)).offset(KEEP).limit(1);
    const old = lt(playReports.createdAt, now - KEEP_MS);
    await this.db.delete(playReports).where(and(mine, cutoff ? or(old, lte(playReports.id, cutoff.id)) : old));
  }
}

function clean(a: PlayAttempt): PlayAttempt {
  return {
    ...(a.fileId !== undefined && { fileId: a.fileId }),
    ...(a.copy && { copy: a.copy }),
    ...(a.stage && { stage: a.stage }),
    ...(a.error && { error: redactSecrets(a.error) }),
    ...(a.servers?.length && { servers: a.servers.map((s) => ({ host: s.host, error: redactSecrets(s.error) })) }),
  };
}
