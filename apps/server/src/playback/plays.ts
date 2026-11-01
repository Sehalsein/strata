import type { Library } from "../library";
import { parseTorboxRef } from "../sources/torbox/sync";
import type { PlaybackSession, SessionManager } from "./sessions";

/**
 * One household's plays. The server keeps every play together (SessionManager); here a
 * household only ever sees, stops or touches its own, and a person only theirs.
 */
export class HouseholdPlays {
  constructor(
    private readonly sessions: SessionManager,
    private readonly organizationId: string,
    private readonly library: Library,
  ) {}

  /** The household's live plays (for its admins). */
  async list(): Promise<PlaybackSession[]> {
    return (await this.sessions.list()).filter((s) => s.organizationId === this.organizationId);
  }

  /** `userId`'s play `id` in this household, if it's still going; asking keeps it alive. */
  async mine(userId: string, id: string): Promise<PlaybackSession | undefined> {
    const session = await this.sessions.get(id);
    return session && session.userId === userId && session.organizationId === this.organizationId ? session : undefined;
  }

  /** Stops a play of this household's. False when there's no such play here. */
  async stop(id: string): Promise<boolean> {
    if (!(await this.list()).some((s) => s.id === id)) return false;
    await this.sessions.stop(id);
    return true;
  }

  /** Whether one of the household's plays streams from TorBox torrent `torrentId` (housekeeping keeps it). */
  async streaming(torrentId: number): Promise<boolean> {
    for (const s of await this.list()) {
      const ref = (await this.library.get(s.fileId))?.ref;
      if (ref?.startsWith("torrents:") && parseTorboxRef(ref).itemId === torrentId) return true;
    }
    return false;
  }
}
