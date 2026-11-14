import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { LibraryFile, PlayLink } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Tone = "info" | "ok" | "warn" | "error";
interface LogLine {
  at: number;
  tone: Tone;
  text: string;
}

/** What this browser says about a codec or container: "probably", "maybe" or "" (no). */
function supports(mime: string): "yes" | "maybe" | "no" {
  const ms = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(mime);
  const answer = document.createElement("video").canPlayType(mime);
  if (ms || answer === "probably") return "yes";
  return answer === "maybe" ? "maybe" : "no";
}

const VIDEO_MIME: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
  av1: 'video/mp4; codecs="av01.0.12M.10"',
  vp9: 'video/webm; codecs="vp09.00.40.08"',
};
const AUDIO_MIME: Record<string, string> = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: "audio/mpeg",
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  opus: 'audio/webm; codecs="opus"',
  flac: 'audio/mp4; codecs="flac"',
  alac: 'audio/mp4; codecs="alac"',
};
const CONTAINER_MIME: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", mkv: "video/x-matroska", webm: "video/webm" };

/** Whether this browser can play what the file holds, part by part. */
function browserSupport(info: NonNullable<PlayLink["info"]>) {
  const rows: { part: string; verdict: "yes" | "maybe" | "no" }[] = [];
  const container = info.container?.split(",")[0];
  if (container) rows.push({ part: `Container ${container}`, verdict: CONTAINER_MIME[container] ? supports(CONTAINER_MIME[container]) : "no" });
  if (info.video) {
    const v = info.video;
    const label = [v.codec, v.height ? `${v.height}p` : null, v.bitDepth ? `${v.bitDepth}-bit` : null, v.hdr].filter(Boolean).join(" · ");
    rows.push({ part: `Video ${label}`, verdict: VIDEO_MIME[v.codec] ? supports(VIDEO_MIME[v.codec]!) : "no" });
  }
  for (const a of info.audio) {
    rows.push({ part: `Audio ${a.codec} ${a.channels}ch${a.language ? ` (${a.language})` : ""}`, verdict: AUDIO_MIME[a.codec] ? supports(AUDIO_MIME[a.codec]!) : "no" });
  }
  return rows;
}

const MEDIA_ERRORS: Record<number, string> = {
  1: "aborted",
  2: "network error: the file server stopped answering or refused",
  3: "decode error: the browser couldn't decode what it got",
  4: "not supported: the browser can't open it, or never got any of it",
};

const fmtTime = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "—");

/**
 * Plays a library file straight from its link (TorBox's, or this server's disk), with a
 * live log of what the browser does: which file server, how long until it answers, stalls
 * and errors. For debugging: no progress is saved and nothing is repackaged.
 */
export function PlayDialog({ file, onOpenChange }: { file: LibraryFile | null; onOpenChange: (open: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [link, setLink] = useState<PlayLink | null>(null);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [stats, setStats] = useState("");
  const started = useRef(0);
  const answered = useRef(false);

  const add = useCallback((tone: Tone, text: string) => {
    setLog((l) => [...l.slice(-199), { at: performance.now() - started.current, tone, text }]);
  }, []);

  const fetchLink = useCallback(
    async (f: LibraryFile, again: boolean) => {
      setLoading(true);
      started.current = performance.now();
      answered.current = false;
      if (!again) setLog([]);
      add("info", again ? "Asking for a new link…" : "Asking the server for a link…");
      try {
        const l = await api.playLink(f.fileId);
        setLink(l);
        add("ok", l.host ? `Link points at ${l.host}` : "Link is this server's own copy of the file");
      } catch (err) {
        add("error", `No link: ${errorMessage(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [add],
  );

  useEffect(() => {
    if (file) void fetchLink(file, false);
    else {
      setLink(null);
      setLog([]);
      setStats("");
    }
  }, [file, fetchLink]);

  // Whether the file server answers at all, apart from what the browser makes of the file
  // (Chrome reports a refused connection as a "format error"). Only the response headers
  // are waited for; the download is cut off there.
  useEffect(() => {
    if (!link) return;
    const ctl = new AbortController();
    const t0 = performance.now();
    const timer = setTimeout(() => ctl.abort("timeout"), 15_000);
    const target = new URL(link.url, location.origin);
    const sameOrigin = target.origin === location.origin;
    fetch(target, { mode: sameOrigin ? "same-origin" : "no-cors", cache: "no-store", signal: ctl.signal, ...(sameOrigin && { headers: { Range: "bytes=0-0" } }) })
      .then((res) => {
        const status = res.type === "opaque" ? "" : ` (HTTP ${res.status})`;
        add(res.type === "opaque" || res.ok ? "ok" : "error", `Connection check: ${link.host ?? "this server"} answered in ${Math.round(performance.now() - t0)} ms${status}`);
      })
      .catch((err) => {
        if (ctl.signal.reason === "closed") return;
        add("error", ctl.signal.aborted
          ? `Connection check: ${link.host ?? "this server"} didn't answer in 15 s`
          : `Connection check: ${link.host ?? "this server"} refused or couldn't be reached (${err instanceof Error ? err.message : String(err)})`);
      })
      .finally(() => {
        clearTimeout(timer);
        ctl.abort("closed");
      });
    return () => ctl.abort("closed");
  }, [link, add]);

  // Nothing back from the file server for a while: say so, as the apps would wait too.
  useEffect(() => {
    if (!link) return;
    const timer = setTimeout(() => {
      if (!answered.current) add("warn", "No answer from the file server after 15 s");
    }, 15_000);
    return () => clearTimeout(timer);
  }, [link, add]);

  // Live numbers: position, buffered ahead, picture size, dropped frames.
  useEffect(() => {
    if (!link) return;
    const timer = setInterval(() => {
      const v = video.current;
      if (!v) return;
      let ahead = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) ahead = v.buffered.end(i) - v.currentTime;
      }
      const q = v.getVideoPlaybackQuality?.();
      setStats(
        [
          `${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}`,
          `${ahead.toFixed(1)} s buffered`,
          v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : null,
          q ? `${q.droppedVideoFrames} dropped of ${q.totalVideoFrames}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [link]);

  const close = (open: boolean) => {
    if (!open && video.current) {
      // Stop downloading now, not when the element is collected.
      video.current.removeAttribute("src");
      video.current.load();
    }
    onOpenChange(open);
  };

  const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
  const support = link?.info ? browserSupport(link.info) : [];
  const bitrate = link?.info?.bitrate ? `${(link.info.bitrate / 1e6).toFixed(0)} Mbit/s` : null;
  const absolute = link ? new URL(link.url, location.origin).toString() : "";

  const events = {
    onLoadStart: () => add("info", "Connecting to the file…"),
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => {
      answered.current = true;
      const v = e.currentTarget;
      add("ok", `File opened: ${fmtTime(v.duration)} long${v.videoWidth ? `, ${v.videoWidth}×${v.videoHeight}` : ", no picture the browser can show"}`);
    },
    onLoadedData: () => add("ok", "First frame ready"),
    onPlaying: () => add("ok", "Playing"),
    onWaiting: () => add("warn", "Waiting for data (buffering)"),
    onStalled: () => add("warn", "Stalled: the file server stopped sending"),
    onSeeking: (e: React.SyntheticEvent<HTMLVideoElement>) => add("info", `Seeking to ${fmtTime(e.currentTarget.currentTime)}`),
    onEnded: () => add("info", "Ended"),
    onError: (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const err = e.currentTarget.error;
      if (!err) return;
      const before = !answered.current ? " before the file opened: see the connection check" : "";
      add("error", `Error ${err.code} (${MEDIA_ERRORS[err.code] ?? "unknown"})${before}${err.message ? `: ${err.message}` : ""}`);
    },
  };

  return (
    <Dialog open={!!file} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="pr-6 break-all">{file?.title ?? file?.name}</DialogTitle>
          <DialogDescription className="break-all">
            {file?.name} · {file ? formatBytes(file.size) : null}
            {bitrate && ` · ${bitrate}`}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted relative aspect-video overflow-hidden rounded-lg">
          {link && <video ref={video} key={link.url} src={link.url} controls autoPlay playsInline className="size-full bg-black" {...events} />}
          {loading && (
            <div className="absolute inset-0 grid place-items-center">
              <LoaderCircle className="text-muted-foreground animate-spin" />
            </div>
          )}
        </div>
        {stats && <p className="text-muted-foreground font-mono text-xs">{stats}</p>}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!file || loading} onClick={() => file && void fetchLink(file, true)}>
            <RefreshCw /> New link
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!link}
            onClick={() => void navigator.clipboard.writeText(absolute).then(() => toast.success("Link copied (it holds the TorBox key: don't share it)"))}
          >
            <Copy /> Copy link
          </Button>
          <Button variant="outline" size="sm" disabled={!link} asChild={!!link}>
            {link ? (
              <a href={absolute} target="_blank" rel="noreferrer">
                <ExternalLink /> Open link
              </a>
            ) : (
              <span>
                <ExternalLink /> Open link
              </span>
            )}
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
          <div className="space-y-1">
            <p className="text-sm font-medium">What happened</p>
            <ol className="bg-muted/50 max-h-56 space-y-0.5 overflow-y-auto rounded-lg p-3 font-mono text-xs">
              {log.map((l, i) => (
                <li key={i} className={cn(l.tone === "error" && "text-destructive", l.tone === "warn" && "text-warn", l.tone === "ok" && "text-ok")}>
                  <span className="text-muted-foreground mr-2 inline-block w-14 text-right">+{ms(l.at)}</span>
                  {l.text}
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">This browser can play</p>
            {support.length === 0 ? (
              <p className="text-muted-foreground text-xs">The file's details aren't known yet: an app reads them the first time it plays it.</p>
            ) : (
              <ul className="space-y-1">
                {support.map((s) => (
                  <li key={s.part} className="flex items-start justify-between gap-2 text-xs">
                    <span className="break-words">{s.part}</span>
                    <Badge variant={s.verdict === "yes" ? "success" : s.verdict === "maybe" ? "warning" : "destructive"}>{s.verdict}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground pt-1 text-xs">
              The apps repackage MKV and decode DTS or TrueHD themselves, so a "no" here doesn't mean the apps can't play it. A file that never opens, or a network error, is the file server.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
