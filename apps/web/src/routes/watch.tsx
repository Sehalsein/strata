import { useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import {
  ArrowLeft,
  Subtitles,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  getItem,
  buildStreamPlan,
  reportPlaybackStart,
  reportPlaybackProgress,
  reportPlaybackStopped,
  ticksToSeconds,
  type BaseItemDto,
} from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";

type Stream = {
  Index: number;
  Language: string | null;
  DisplayTitle: string | null;
  Codec: string | null;
  IsForced: boolean;
  IsDefault: boolean;
  IsExternal: boolean;
  IsTextSubtitleStream: boolean;
};

const collectAudioStreams = (item: BaseItemDto): Stream[] =>
  (item.MediaSources?.[0]?.MediaStreams ?? [])
    .filter((s) => s.Type === "Audio" && s.Index !== undefined)
    .map((s) => ({
      Index: s.Index!,
      Language: s.Language ?? null,
      DisplayTitle: s.DisplayTitle ?? null,
      Codec: s.Codec ?? null,
      IsForced: Boolean(s.IsForced),
      IsDefault: Boolean(s.IsDefault),
      IsExternal: Boolean(s.IsExternal),
      IsTextSubtitleStream: Boolean(s.IsTextSubtitleStream),
    }));

const collectSubtitleStreams = (item: BaseItemDto): Stream[] =>
  (item.MediaSources?.[0]?.MediaStreams ?? [])
    .filter(
      (s) =>
        s.Type === "Subtitle" &&
        s.Index !== undefined &&
        // Image-based subs (PGS/SUP) can't be rendered by hls.js / browser
        s.IsTextSubtitleStream !== false,
    )
    .map((s) => ({
      Index: s.Index!,
      Language: s.Language ?? null,
      DisplayTitle: s.DisplayTitle ?? null,
      Codec: s.Codec ?? null,
      IsForced: Boolean(s.IsForced),
      IsDefault: Boolean(s.IsDefault),
      IsExternal: Boolean(s.IsExternal),
      IsTextSubtitleStream: Boolean(s.IsTextSubtitleStream),
    }));

export const WatchPage = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  if (!session) return <Navigate to="/login" />;

  const detail = useQuery({
    queryKey: ["item", id],
    queryFn: () => getItem(id),
  });

  if (detail.isLoading) {
    return <PlayerShell title="Loading…" overlay="loading" message="Loading metadata…" />;
  }
  if (detail.isError || !detail.data) {
    return <PlayerShell title="" overlay="error" message="Couldn't load this title." />;
  }

  const item = detail.data;
  const audioTracks = collectAudioStreams(item);
  const subtitleTracks = collectSubtitleStreams(item);
  const defaultAudio = audioTracks.find((a) => a.IsDefault) ?? audioTracks[0];
  const defaultSub = subtitleTracks.find((s) => s.IsDefault);
  const resumeSeconds =
    ticksToSeconds(item.UserData?.PlaybackPositionTicks) ?? 0;

  return (
    <Player
      itemId={id}
      title={item.Name ?? "Now Playing"}
      audioTracks={audioTracks}
      subtitleTracks={subtitleTracks}
      defaultAudioIndex={defaultAudio?.Index}
      defaultSubtitleIndex={defaultSub?.Index}
      resumeAt={resumeSeconds}
    />
  );
};

type PlayerProps = {
  itemId: string;
  title: string;
  audioTracks: Stream[];
  subtitleTracks: Stream[];
  defaultAudioIndex?: number;
  defaultSubtitleIndex?: number;
  resumeAt: number;
};

type PlayerState =
  | { kind: "loading"; message: string }
  | { kind: "ready" }
  | { kind: "error"; message: string; detail?: string };

const Player = ({
  itemId,
  title,
  audioTracks,
  subtitleTracks,
  defaultAudioIndex,
  defaultSubtitleIndex,
  resumeAt,
}: PlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const sessionRef = useRef<{
    playSessionId: string;
    mediaSourceId: string;
  } | null>(null);
  const [currentAudio, setCurrentAudio] = useState<number | undefined>(
    defaultAudioIndex,
  );
  const [currentSub, setCurrentSub] = useState<number | "off">(
    defaultSubtitleIndex ?? "off",
  );
  const [state, setState] = useState<PlayerState>({
    kind: "loading",
    message: "Preparing stream…",
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let usingDirect = true;
    let hls: Hls | null = null;
    let plan: Awaited<ReturnType<typeof buildStreamPlan>> | null = null;

    const cleanupHls = () => {
      if (hls) {
        try {
          hls.destroy();
        } catch {}
        hls = null;
        hlsRef.current = null;
      }
    };

    const attachHls = (url: string) => {
      const supportsNative = video.canPlayType("application/vnd.apple.mpegurl");
      if (supportsNative) {
        video.src = url;
        return;
      }
      if (!Hls.isSupported()) {
        setState({
          kind: "error",
          message: "This browser doesn't support HLS playback.",
        });
        return;
      }
      hls = new Hls({
        enableWorker: true,
        backBufferLength: 90,
      });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        const status = data.response?.code;
        const msg =
          status === 404
            ? "Stream not found on server"
            : data.type === Hls.ErrorTypes.NETWORK_ERROR
              ? "Network error fetching the stream"
              : data.type === Hls.ErrorTypes.MEDIA_ERROR
                ? "Media error — segment couldn't be decoded"
                : "Streaming failed";
        const detail = [
          data.details,
          status ? `HTTP ${status}` : null,
          data.error?.message,
        ]
          .filter(Boolean)
          .join(" · ");
        setState({ kind: "error", message: msg, detail });
      });
    };

    const fallbackToHls = () => {
      if (!plan || !usingDirect) return;
      usingDirect = false;
      cleanupHls();
      video.removeAttribute("src");
      video.load();
      setState({ kind: "loading", message: "Switching to transcoded stream…" });
      attachHls(plan.hlsUrl);
    };

    const onCanPlay = () => setState({ kind: "ready" });
    const onWaiting = () =>
      setState((s) =>
        s.kind === "ready" ? { kind: "loading", message: "Buffering…" } : s,
      );
    const onPlaying = () => setState({ kind: "ready" });
    const onVideoError = () => {
      const err = video.error;
      if (usingDirect && (err?.code === 3 || err?.code === 4)) {
        console.warn("[player] direct play unsupported, falling back to HLS", err?.message);
        fallbackToHls();
        return;
      }
      const msg =
        err?.code === 1
          ? "Playback aborted"
          : err?.code === 2
            ? "Network error while loading the stream"
            : err?.code === 3
              ? "Decoder error — codec not supported even after transcode"
              : err?.code === 4
                ? "Stream not supported by this browser"
                : "Video error";
      setState({ kind: "error", message: msg, detail: err?.message });
    };

    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onVideoError);

    const onLoadedMetadata = () => {
      if (resumeAt > 0) video.currentTime = resumeAt;
      void video.play().catch(() => {});
    };
    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });

    (async () => {
      try {
        plan = await buildStreamPlan(itemId, {
          audioStreamIndex: currentAudio,
          subtitleStreamIndex: currentSub === "off" ? undefined : currentSub,
        });
        if (cancelled) return;
        sessionRef.current = {
          playSessionId: plan.playSessionId,
          mediaSourceId: plan.mediaSourceId,
        };
        await reportPlaybackStart(
          itemId,
          plan.playSessionId,
          plan.mediaSourceId,
        );
        video.src = plan.directUrl;
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: "Couldn't initialize playback",
          detail: err instanceof Error ? err.message : undefined,
        });
      }
    })();

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onVideoError);
      cleanupHls();
      const session = sessionRef.current;
      if (session) {
        void reportPlaybackStopped(
          itemId,
          session.playSessionId,
          session.mediaSourceId,
          Math.floor(video.currentTime || 0),
        ).catch(() => {});
        sessionRef.current = null;
      }
      video.removeAttribute("src");
      video.load();
    };
    // currentAudio + currentSub trigger full re-init via the key prop swap below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, currentAudio, currentSub]);

  // Progress heartbeat every 10s.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handle = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) return;
      if (video.ended) return;
      void reportPlaybackProgress(
        itemId,
        session.playSessionId,
        session.mediaSourceId,
        Math.floor(video.currentTime),
        video.paused,
      ).catch(() => {});
    }, 10_000);
    return () => window.clearInterval(handle);
  }, [itemId]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button
          onClick={() => history.back()}
          className="inline-flex items-center gap-2 text-sm opacity-80 hover:opacity-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="text-sm font-semibold">{title}</div>
        <div className="flex gap-2">
          {audioTracks.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-white">
                  Audio
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Audio</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {audioTracks.map((a) => (
                  <DropdownMenuItem
                    key={a.Index}
                    active={a.Index === currentAudio}
                    onSelect={() => setCurrentAudio(a.Index)}
                  >
                    {a.DisplayTitle ?? a.Language ?? `Track ${a.Index}`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {subtitleTracks.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-white">
                  <Subtitles className="h-4 w-4" />
                  Subtitles
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Subtitles</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  active={currentSub === "off"}
                  onSelect={() => setCurrentSub("off")}
                >
                  Off
                </DropdownMenuItem>
                {subtitleTracks.map((s) => (
                  <DropdownMenuItem
                    key={s.Index}
                    active={s.Index === currentSub}
                    onSelect={() => setCurrentSub(s.Index)}
                  >
                    {s.DisplayTitle ?? s.Language ?? `Track ${s.Index}`}
                    {s.IsForced ? " (Forced)" : ""}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="relative flex-1">
        <video
          ref={videoRef}
          controls
          playsInline
          className="h-full w-full bg-black"
        />
        {state.kind === "loading" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-white">
            <div className="flex items-center gap-3 rounded-lg bg-black/60 px-4 py-2 backdrop-blur">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{state.message}</span>
            </div>
          </div>
        )}
        {state.kind === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-white">
            <div className="max-w-md space-y-4 rounded-lg border border-border bg-card p-6 text-center">
              <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
              <div className="text-base font-semibold">{state.message}</div>
              {state.detail && (
                <div className="break-words font-mono text-xs text-muted-foreground">
                  {state.detail}
                </div>
              )}
              <div className="flex justify-center gap-2">
                <Button onClick={() => window.location.reload()}>Try again</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const PlayerShell = ({
  title,
  overlay,
  message,
}: {
  title: string;
  overlay: "loading" | "error";
  message: string;
}) => (
  <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
    <div className="flex items-center justify-between px-4 py-3">
      <button
        onClick={() => history.back()}
        className="inline-flex items-center gap-2 text-sm opacity-80 hover:opacity-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <div className="text-sm font-semibold">{title}</div>
      <div className="w-12" />
    </div>
    <div className="flex flex-1 items-center justify-center">
      {overlay === "loading" ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {message}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          {message}
        </div>
      )}
    </div>
  </div>
);
