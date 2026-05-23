import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { RotateCcw, RotateCw } from "lucide-react";
import Hls from "hls.js";
import {
  buildStreamPlan,
  reportPlaybackStart,
  reportPlaybackProgress,
  reportPlaybackStopped,
  subtitleVttUrl,
  type BaseItemDto,
  type StreamPlan,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { PlayerHeader } from "./PlayerHeader";
import { Scrubber } from "./Scrubber";
import { TransportBar } from "./TransportBar";
import { CenterPlayButton } from "./CenterPlayButton";
import { SubtitleOverlay } from "./SubtitleOverlay";
import { ChaptersRail } from "./ChaptersRail";
import { useVideoState } from "./hooks/useVideoState";
import { useAutoHide } from "./hooks/useAutoHide";
import { usePersistentVolume } from "./hooks/usePersistentVolume";
import { usePersistedFlag } from "./hooks/usePersistedFlag";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useTrickplay } from "./hooks/useTrickplay";
import { useNextEpisode } from "./hooks/useNextEpisode";
import { useScenePreview } from "./hooks/useScenePreview";
import {
  collectAudioStreams,
  collectChapters,
  collectSubtitleStreams,
  type PlayerApi,
  type Stream,
} from "./types";

type PlayerState =
  | { kind: "loading"; message: string }
  | { kind: "ready" }
  | { kind: "error"; message: string; detail?: string };

type Props = {
  item: BaseItemDto;
  resumeAt: number;
};

export const Player = ({ item, resumeAt }: Props) => {
  const itemId = item.Id!;
  const navigate = useNavigate();

  const audioTracks = useMemo(() => collectAudioStreams(item), [item]);
  const subtitleTracks = useMemo(() => collectSubtitleStreams(item), [item]);
  const chapters = useMemo(() => collectChapters(item), [item]);
  const defaultAudio = audioTracks.find((a) => a.IsDefault) ?? audioTracks[0];
  const defaultSub = subtitleTracks.find((s) => s.IsDefault);

  const [currentAudio, setCurrentAudio] = useState<number | undefined>(
    defaultAudio?.Index,
  );
  const [currentSub, setCurrentSub] = useState<number | "off">(
    defaultSub?.Index ?? "off",
  );
  // Remembers the last enabled subtitle index so `toggleSubtitle()` can
  // restore it after turning captions off.
  const lastSubRef = useRef<number | null>(
    defaultSub?.Index ?? subtitleTracks[0]?.Index ?? null,
  );
  useEffect(() => {
    if (currentSub !== "off") lastSubRef.current = currentSub;
  }, [currentSub]);
  const [state, setState] = useState<PlayerState>({
    kind: "loading",
    message: "Preparing stream…",
  });
  const [plan, setPlan] = useState<StreamPlan | null>(null);
  const [usingHls, setUsingHls] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const sessionRef = useRef<{
    playSessionId: string;
    mediaSourceId: string;
  } | null>(null);

  const { next: nextEpisode, prev: prevEpisode } = useNextEpisode(item);
  const trickplay = useTrickplay(itemId, item.Trickplay);
  const videoState = useVideoState(videoRef);
  usePersistentVolume(videoRef);

  // Safari requires this non-standard attribute before it will let JS
  // invoke the AirPlay target picker on a <video>. Set via DOM so we
  // don't have to teach the JSX type system about it.
  useEffect(() => {
    videoRef.current?.setAttribute("x-webkit-airplay", "allow");
  }, []);

  // Live scene preview as a fallback when there's no trickplay manifest.
  // Only mount when the source is direct-playable (HLS sources would
  // trigger fresh transcode segments on every seek).
  const scenePreviewSrc =
    !trickplay && plan && !usingHls ? plan.directUrl : null;
  const scenePreview = useScenePreview(scenePreviewSrc);

  const hasChapters = chapters.length > 0;
  const railHasContent = hasChapters || Boolean(nextEpisode);
  const [railOpen, , toggleRailFlag] = usePersistedFlag(
    "strata.railOpen",
    hasChapters,
  );
  const railVisible = railHasContent && railOpen;

  // ----- streaming pipeline (preserved from original watch.tsx) -----
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let usingDirect = true;
    let hls: Hls | null = null;
    let localPlan: StreamPlan | null = null;

    const cleanupHls = () => {
      if (hls) {
        try {
          hls.destroy();
        } catch {
          /* noop */
        }
        hls = null;
        hlsRef.current = null;
      }
    };

    const attachHls = (url: string) => {
      const supportsNative = video.canPlayType("application/vnd.apple.mpegurl");
      setUsingHls(true);
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
      hls = new Hls({ enableWorker: true, backBufferLength: 90 });
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
      if (!localPlan || !usingDirect) return;
      usingDirect = false;
      cleanupHls();
      video.removeAttribute("src");
      video.load();
      setState({ kind: "loading", message: "Switching to transcoded stream…" });
      attachHls(localPlan.hlsUrl);
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
        console.warn(
          "[player] direct play unsupported, falling back to HLS",
          err?.message,
        );
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
        localPlan = await buildStreamPlan(itemId, {
          audioStreamIndex: currentAudio,
          // Subtitles are loaded as a separate WebVTT <track> element
          // (see the effect below) so changing them doesn't restart the
          // transcode session and they work on every playback path.
        });
        if (cancelled) return;
        setPlan(localPlan);
        sessionRef.current = {
          playSessionId: localPlan.playSessionId,
          mediaSourceId: localPlan.mediaSourceId,
        };
        await reportPlaybackStart(
          itemId,
          localPlan.playSessionId,
          localPlan.mediaSourceId,
        );
        if (localPlan.preferHls) {
          usingDirect = false;
          attachHls(localPlan.hlsUrl);
        } else {
          setUsingHls(false);
          video.src = localPlan.directUrl;
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, currentAudio]);

  // Manages the WebVTT <track> element on the video. Decoupled from the
  // streaming effect so toggling subtitles is instant and doesn't reset
  // the transcode session.
  useEffect(() => {
    const video = videoRef.current;
    const mediaSourceId = plan?.mediaSourceId;
    if (!video || !mediaSourceId || currentSub === "off") return;

    const trackEl = document.createElement("track");
    trackEl.kind = "subtitles";
    trackEl.label = "Subtitles";
    trackEl.srclang = "und";
    trackEl.src = subtitleVttUrl(itemId, mediaSourceId, currentSub);
    video.appendChild(trackEl);

    // Browsers default new tracks to "disabled" which prevents cue
    // loading. Force "hidden" so cues load and become activeCues
    // (SubtitleOverlay polls activeCues to render).
    const enable = () => {
      if (trackEl.track) trackEl.track.mode = "hidden";
    };
    enable();
    trackEl.addEventListener("load", enable);

    const onError = (e: Event) => {
      console.error(
        "[player] subtitle track failed",
        e,
        trackEl.src,
        trackEl.readyState,
      );
    };
    trackEl.addEventListener("error", onError);

    return () => {
      trackEl.removeEventListener("load", enable);
      trackEl.removeEventListener("error", onError);
      trackEl.remove();
    };
  }, [itemId, plan?.mediaSourceId, currentSub]);

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

  // ----- PlayerApi (stable handle for transport + keyboard) -----
  const rootRef = useRef<HTMLDivElement>(null);

  const playByItemId = useCallback(
    (id: string) => navigate({ to: "/watch/$id", params: { id } }),
    [navigate],
  );

  const api: PlayerApi = useMemo(
    () => ({
      play: () => void videoRef.current?.play().catch(() => {}),
      pause: () => videoRef.current?.pause(),
      toggle: () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) void v.play().catch(() => {});
        else v.pause();
      },
      seek: (sec) => {
        const v = videoRef.current;
        if (!v || !Number.isFinite(v.duration)) return;
        v.currentTime = Math.max(0, Math.min(v.duration, sec));
      },
      seekBy: (delta) => {
        const v = videoRef.current;
        if (!v) return;
        const target = (v.currentTime || 0) + delta;
        v.currentTime = Math.max(
          0,
          Number.isFinite(v.duration) ? Math.min(v.duration, target) : target,
        );
      },
      setRate: (rate) => {
        const v = videoRef.current;
        if (!v) return;
        v.playbackRate = rate;
      },
      cycleSpeed: () => {
        const v = videoRef.current;
        if (!v) return;
        const order = [1, 1.5, 2];
        const idx = order.findIndex((r) => Math.abs(r - v.playbackRate) < 0.01);
        v.playbackRate = order[(idx + 1) % order.length] ?? 1;
      },
      toggleSubtitle: () => {
        if (subtitleTracks.length === 0) return;
        setCurrentSub((prev) => {
          if (prev !== "off") return "off";
          return lastSubRef.current ?? subtitleTracks[0]!.Index;
        });
      },
      toggleRail: () => {
        if (!railHasContent) return;
        toggleRailFlag();
      },
      setVolume: (vol) => {
        const v = videoRef.current;
        if (!v) return;
        v.volume = Math.max(0, Math.min(1, vol));
        if (vol > 0 && v.muted) v.muted = false;
      },
      toggleMute: () => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
      },
      toggleFullscreen: () => {
        // iPhone Safari: document.fullscreen* is unsupported; the
        // <video> exposes webkitEnterFullscreen which hands off to the
        // native iOS player UI. That's the right behavior on phones,
        // where faking fullscreen still leaves PWA chrome around.
        const video = videoRef.current as
          | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
          | null;
        if (
          video &&
          typeof video.webkitEnterFullscreen === "function" &&
          !document.fullscreenEnabled
        ) {
          video.webkitEnterFullscreen();
          return;
        }
        const el = rootRef.current;
        if (!el) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void el.requestFullscreen().catch(() => {});
      },
      prevEpisode: prevEpisode?.Id ? () => playByItemId(prevEpisode.Id!) : null,
      nextEpisode: nextEpisode?.Id ? () => playByItemId(nextEpisode.Id!) : null,
    }),
    [
      playByItemId,
      prevEpisode,
      nextEpisode,
      railHasContent,
      subtitleTracks,
      toggleRailFlag,
    ],
  );

  useKeyboardShortcuts(api, videoRef);

  // ----- Auto-hide -----
  const autoHide = useAutoHide(videoState.playing);

  // ----- Touch tap gestures (mobile) -----
  // Single tap on the canvas: show controls; if already visible, also
  // toggle play/pause. Double-tap left/right half: seek ∓10s with a
  // brief ripple. Mouse pointer events are ignored — desktop already
  // has hover/move-driven controls.
  const tapStateRef = useRef<{
    time: number;
    side: "left" | "right";
    timer: number | null;
  } | null>(null);
  const [seekRipple, setSeekRipple] = useState<{
    side: "left" | "right";
    seq: number;
  } | null>(null);

  const fireSeekRipple = useCallback((side: "left" | "right") => {
    setSeekRipple((prev) => ({ side, seq: (prev?.seq ?? 0) + 1 }));
    window.setTimeout(() => {
      setSeekRipple((prev) =>
        prev && prev.side === side ? null : prev,
      );
    }, 650);
  }, []);

  const handleCanvasTap = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Mouse already has a richer hover-driven UX. Only handle touch
      // and pen here.
      if (e.pointerType === "mouse") return;

      const rect = e.currentTarget.getBoundingClientRect();
      const side: "left" | "right" =
        e.clientX - rect.left < rect.width / 2 ? "left" : "right";
      const now = Date.now();
      const prev = tapStateRef.current;

      if (prev && now - prev.time < 280 && prev.side === side) {
        if (prev.timer !== null) window.clearTimeout(prev.timer);
        tapStateRef.current = null;
        api.seekBy(side === "left" ? -10 : 10);
        fireSeekRipple(side);
        autoHide.bump();
        return;
      }

      // Capture visibility at tap time so the queued single-tap action
      // reflects what the user actually saw.
      const wasVisible = autoHide.visible;
      if (prev?.timer !== null && prev?.timer !== undefined) {
        window.clearTimeout(prev.timer);
      }
      const timer = window.setTimeout(() => {
        tapStateRef.current = null;
        if (wasVisible) api.toggle();
        autoHide.bump();
      }, 250);
      tapStateRef.current = { time: now, side, timer };
    },
    [api, autoHide, fireSeekRipple],
  );

  useEffect(
    () => () => {
      if (tapStateRef.current?.timer !== undefined && tapStateRef.current?.timer !== null) {
        window.clearTimeout(tapStateRef.current.timer);
      }
    },
    [],
  );

  const handleBack = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else void navigate({ to: "/" });
  }, [navigate]);

  const breadcrumb = useMemo(
    () => ({
      show: item.SeriesName ?? null,
      season: item.ParentIndexNumber ?? null,
      episode: item.IndexNumber ?? null,
      title: item.Name ?? "",
    }),
    [item.IndexNumber, item.Name, item.ParentIndexNumber, item.SeriesName],
  );

  const mediaSource = item.MediaSources?.[0] ?? null;

  const transcoding = useMemo(
    () => ({
      kind: usingHls ? ("hls" as const) : ("direct" as const),
      bitrate: plan?.bitrate ?? null,
    }),
    [usingHls, plan?.bitrate],
  );

  return (
    <div
      ref={rootRef}
      onMouseMove={autoHide.bump}
      onMouseLeave={() => {
        if (videoState.playing) autoHide.hideNow();
      }}
      className={cn(
        "fixed inset-0 z-50 bg-strata-bg text-strata-paper",
        !autoHide.visible && videoState.playing && "cursor-none",
      )}
    >
      <div
        className={cn(
          "grid h-full w-full",
          railVisible
            ? "grid-cols-1 lg:grid-cols-[1fr_340px]"
            : "grid-cols-1",
        )}
      >
        <div className="relative h-full w-full overflow-hidden bg-black">
          <video
            ref={videoRef}
            playsInline
            controls={false}
            className="absolute inset-0 h-full w-full bg-black"
          />
          {/* Touch tap-capture layer. Sits above the <video> and below
              all interactive controls (z-10 < z-20/z-30) so taps on the
              transport, header, or center button never reach this. */}
          <div
            className="absolute inset-0 z-10"
            onPointerUp={handleCanvasTap}
          />
          <SubtitleOverlay videoRef={videoRef} />

          <AnimatePresence>
            {seekRipple && (
              <motion.div
                key={`${seekRipple.side}-${seekRipple.seq}`}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.18, ease: [0.2, 0.6, 0.2, 1] }}
                className={cn(
                  "pointer-events-none absolute top-1/2 z-20 flex h-20 w-20 -translate-y-1/2 items-center justify-center rounded-full bg-strata-bg/55 text-strata-paper backdrop-blur-md",
                  seekRipple.side === "left"
                    ? "left-[16%] -translate-x-1/2"
                    : "right-[16%] translate-x-1/2",
                )}
                aria-hidden
              >
                {seekRipple.side === "left" ? (
                  <RotateCcw className="h-7 w-7" />
                ) : (
                  <RotateCw className="h-7 w-7" />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <CenterPlayButton
            playing={videoState.playing}
            visible={!videoState.playing || autoHide.visible}
            onClick={api.toggle}
            loading={state.kind === "loading"}
          />

          <PlayerHeader
            visible={autoHide.visible || !videoState.playing}
            breadcrumb={breadcrumb}
            transcoding={transcoding}
            onBack={handleBack}
          />

          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 z-30 transition-opacity duration-300",
              autoHide.visible || !videoState.playing
                ? "opacity-100"
                : "opacity-0",
            )}
          >
            <div
              className={cn(
                "bg-gradient-to-t from-strata-bg/95 via-strata-bg/70 to-transparent pt-16",
                autoHide.visible || !videoState.playing
                  ? "pointer-events-auto"
                  : "pointer-events-none",
              )}
              style={{
                paddingLeft: "max(1.5rem, env(safe-area-inset-left))",
                paddingRight: "max(1.5rem, env(safe-area-inset-right))",
                paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
              }}
            >
              <Scrubber
                duration={videoState.duration}
                currentTime={videoState.currentTime}
                buffered={videoState.buffered}
                chapters={chapters}
                trickplay={trickplay}
                scenePreviewUrl={scenePreview.previewUrl}
                requestScenePreview={scenePreview.requestPreview}
                seeking={videoState.seeking}
                onSeek={api.seek}
              />
              <TransportBar
                api={api}
                state={videoState}
                audioTracks={audioTracks}
                subtitleTracks={subtitleTracks}
                currentAudio={currentAudio}
                currentSub={currentSub}
                onAudioChange={setCurrentAudio}
                onSubChange={setCurrentSub}
                hasPrev={Boolean(prevEpisode)}
                hasNext={Boolean(nextEpisode)}
                mediaSource={mediaSource}
                plan={plan}
                usingHls={usingHls}
                videoRef={videoRef}
                hlsRef={hlsRef}
                railVisible={railVisible}
                railHasContent={railHasContent}
              />
            </div>
          </div>

          {state.kind === "loading" && videoState.duration === 0 && (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center text-strata-paper/80">
              <div className="flex items-center gap-3 rounded-md bg-strata-bg/70 px-4 py-2 backdrop-blur">
                <span className="anim-pulse-dot inline-block h-2 w-2 rounded-full bg-strata-accent" />
                <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
                  {state.message}
                </span>
              </div>
            </div>
          )}
          {state.kind === "error" && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-strata-bg/90 p-6">
              <div className="max-w-md space-y-4 rounded-md border border-strata-paper/15 bg-card p-6 text-center">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-strata-accent">
                  Playback error
                </div>
                <div className="text-base font-semibold">{state.message}</div>
                {state.detail && (
                  <div className="break-words font-mono text-xs text-strata-paper/55">
                    {state.detail}
                  </div>
                )}
                <div className="flex justify-center gap-2">
                  <button
                    onClick={() => window.location.reload()}
                    className="strata-btn-primary"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {railVisible && (
          <ChaptersRail
            visible={autoHide.visible || !videoState.playing}
            chapters={chapters}
            currentTime={videoState.currentTime}
            onSeek={api.seek}
            nextEpisode={nextEpisode}
            currentItem={item}
            trickplay={trickplay}
            onPlayNext={
              nextEpisode?.Id ? () => playByItemId(nextEpisode.Id!) : undefined
            }
          />
        )}
      </div>
    </div>
  );
};

export type { Stream };
