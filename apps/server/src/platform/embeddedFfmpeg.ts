// Replaced while building a release binary (scripts/build.ts) with the pinned ffmpeg and
// ffprobe for its platform, gzipped and embedded, so a home server needs no download. From
// source (and in the cloud build) there's none.
export const embeddedFfmpeg: { version: string; ffmpeg: string; ffprobe: string; notice: string } | null = null;
