import { Jellyfin } from "@jellyfin/sdk";
import type { Api } from "@jellyfin/sdk";
import { getItemsApi } from "@jellyfin/sdk/lib/utils/api/items-api";
import { getUserLibraryApi } from "@jellyfin/sdk/lib/utils/api/user-library-api";
import { getTvShowsApi } from "@jellyfin/sdk/lib/utils/api/tv-shows-api";
import { getMediaInfoApi } from "@jellyfin/sdk/lib/utils/api/media-info-api";
import { getPlaystateApi } from "@jellyfin/sdk/lib/utils/api/playstate-api";
import { getUserApi } from "@jellyfin/sdk/lib/utils/api/user-api";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api";
import {
  BaseItemKind,
  DlnaProfileType,
  EncodingContext,
  ImageType,
  ItemFields,
  ItemSortBy,
  MediaStreamProtocol,
  SortOrder,
  SubtitleDeliveryMethod,
  type BaseItemDto,
  type AuthenticationResult,
  type DeviceProfile,
  type DirectPlayProfile,
} from "@jellyfin/sdk/lib/generated-client/models";

const SERVER_URL =
  import.meta.env.VITE_JELLYFIN_URL ??
  (import.meta.env.DEV ? "/jf" : "http://localhost:8096");

const STORAGE_DEVICE_ID = "strata.deviceId";
const STORAGE_TOKEN = "strata.accessToken";
const STORAGE_USER_ID = "strata.userId";
const STORAGE_USER_NAME = "strata.userName";

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};

const randomUUID = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const getOrCreateDeviceId = (): string => {
  const existing = readStorage(STORAGE_DEVICE_ID);
  if (existing) return existing;
  const id = randomUUID();
  writeStorage(STORAGE_DEVICE_ID, id);
  return id;
};

export const jellyfin = new Jellyfin({
  clientInfo: { name: "Strata", version: "1.0.0" },
  deviceInfo: { name: "Strata Web", id: getOrCreateDeviceId() },
});

export const api: Api = jellyfin.createApi(SERVER_URL);

const hydrate = () => {
  const token = readStorage(STORAGE_TOKEN);
  if (token) api.accessToken = token;
};
hydrate();

export const getServerUrl = (): string => SERVER_URL;

export const getUserId = (): string | null => readStorage(STORAGE_USER_ID);
export const getUserName = (): string | null => readStorage(STORAGE_USER_NAME);
export const getAccessToken = (): string | null => readStorage(STORAGE_TOKEN);
export const hasSession = (): boolean =>
  Boolean(readStorage(STORAGE_TOKEN) && readStorage(STORAGE_USER_ID));

export const persistAuth = (result: AuthenticationResult) => {
  if (!result.AccessToken || !result.User?.Id) {
    throw new Error("Jellyfin auth response missing token or user");
  }
  api.accessToken = result.AccessToken;
  writeStorage(STORAGE_TOKEN, result.AccessToken);
  writeStorage(STORAGE_USER_ID, result.User.Id);
  writeStorage(STORAGE_USER_NAME, result.User.Name ?? "");
};

export const clearAuth = () => {
  api.accessToken = "";
  writeStorage(STORAGE_TOKEN, null);
  writeStorage(STORAGE_USER_ID, null);
  writeStorage(STORAGE_USER_NAME, null);
};

// Auth-expiry interceptor: if Jellyfin replies 401 to any request,
// drop the stored token and dispatch a storage-style event so the
// session hook resolves to null and route guards send the user to
// /login. Avoids leaving the app stuck on a stale-token screen.
api.axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const status: number | undefined = error?.response?.status;
    if (status === 401 && getAccessToken()) {
      clearAuth();
      try {
        window.dispatchEvent(new StorageEvent("storage"));
      } catch {
        /* SSR / older browser */
      }
    }
    return Promise.reject(error);
  },
);

const requireUserId = (): string => {
  const id = getUserId();
  if (!id) throw new Error("Not signed in");
  return id;
};

export const signInWithPassword = async (
  username: string,
  password: string,
): Promise<AuthenticationResult> => {
  const res = await api.authenticateUserByName(username, password);
  persistAuth(res.data);
  return res.data;
};

export const getCurrentUser = async () => {
  const userId = requireUserId();
  const res = await getUserApi(api).getUserById({ userId });
  return res.data;
};

const MOVIE_FIELDS: ItemFields[] = [
  ItemFields.Overview,
  ItemFields.Genres,
  ItemFields.MediaSources,
  ItemFields.MediaStreams,
  ItemFields.OriginalTitle,
  ItemFields.Taglines,
];

export const ticksToSeconds = (ticks: number | null | undefined): number | null =>
  ticks ? Math.round(ticks / 10_000_000) : null;

export const secondsToTicks = (seconds: number): number =>
  Math.round(seconds * 10_000_000);

export const ticksToMinutes = (ticks: number | null | undefined): number | null =>
  ticks ? Math.round(ticks / 600_000_000) : null;

export const listMovies = async (): Promise<BaseItemDto[]> => {
  const res = await getItemsApi(api).getItems({
    userId: requireUserId(),
    includeItemTypes: [BaseItemKind.Movie],
    recursive: true,
    sortBy: [ItemSortBy.DateCreated],
    sortOrder: [SortOrder.Descending],
    fields: MOVIE_FIELDS,
  });
  return res.data.Items ?? [];
};

export const listShows = async (): Promise<BaseItemDto[]> => {
  const res = await getItemsApi(api).getItems({
    userId: requireUserId(),
    includeItemTypes: [BaseItemKind.Series],
    recursive: true,
    sortBy: [ItemSortBy.DateCreated],
    sortOrder: [SortOrder.Descending],
    fields: [ItemFields.Overview, ItemFields.Genres],
  });
  return res.data.Items ?? [];
};

export const getItem = async (itemId: string): Promise<BaseItemDto> => {
  const res = await getUserLibraryApi(api).getItem({
    userId: requireUserId(),
    itemId,
  });
  return res.data;
};

export const getSeasons = async (seriesId: string): Promise<BaseItemDto[]> => {
  const res = await getTvShowsApi(api).getSeasons({
    userId: requireUserId(),
    seriesId,
  });
  return res.data.Items ?? [];
};

export const getSimilarItems = async (
  itemId: string,
  limit = 12,
): Promise<BaseItemDto[]> => {
  const res = await getLibraryApi(api).getSimilarItems({
    itemId,
    userId: requireUserId(),
    limit,
    fields: [ItemFields.Overview, ItemFields.Genres],
  });
  return res.data.Items ?? [];
};

export const setFavorite = async (
  itemId: string,
  isFavorite: boolean,
): Promise<void> => {
  const userId = requireUserId();
  const lib = getUserLibraryApi(api);
  if (isFavorite) {
    await lib.markFavoriteItem({ userId, itemId });
  } else {
    await lib.unmarkFavoriteItem({ userId, itemId });
  }
};

export const getEpisodes = async (
  seriesId: string,
  seasonId?: string,
): Promise<BaseItemDto[]> => {
  const res = await getTvShowsApi(api).getEpisodes({
    userId: requireUserId(),
    seriesId,
    ...(seasonId ? { seasonId } : {}),
    fields: [ItemFields.Overview, ItemFields.MediaSources],
  });
  return res.data.Items ?? [];
};

export const continueWatching = async (
  kinds: BaseItemKind[] = [BaseItemKind.Movie, BaseItemKind.Episode],
): Promise<BaseItemDto[]> => {
  const res = await getItemsApi(api).getResumeItems({
    userId: requireUserId(),
    includeItemTypes: kinds,
    limit: 12,
    fields: [ItemFields.Overview],
  });
  return res.data.Items ?? [];
};

export const search = async (
  term: string,
): Promise<{ movies: BaseItemDto[]; shows: BaseItemDto[] }> => {
  if (term.trim().length < 2) return { movies: [], shows: [] };
  const res = await getItemsApi(api).getItems({
    userId: requireUserId(),
    searchTerm: term,
    includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series],
    recursive: true,
    limit: 50,
    fields: [ItemFields.Overview],
  });
  const items = res.data.Items ?? [];
  return {
    movies: items.filter((i) => i.Type === BaseItemKind.Movie),
    shows: items.filter((i) => i.Type === BaseItemKind.Series),
  };
};

export const imageUrl = (
  itemId: string | null | undefined,
  type: ImageType = ImageType.Primary,
  maxWidth?: number,
): string | null => {
  if (!itemId) return null;
  const qs = new URLSearchParams();
  if (maxWidth) qs.set("maxWidth", String(maxWidth));
  if (api.accessToken) qs.set("api_key", api.accessToken);
  const suffix = qs.toString();
  return `${SERVER_URL}/Items/${itemId}/Images/${type}${suffix ? `?${suffix}` : ""}`;
};

export const backdropUrl = (
  itemId: string | null | undefined,
): string | null => imageUrl(itemId, ImageType.Backdrop, 1920);

export type StreamPlan = {
  directUrl: string;
  hlsUrl: string;
  playSessionId: string;
  mediaSourceId: string;
  preferHls: boolean;
  /** Source media bitrate in bits/sec, or null when not reported. */
  bitrate: number | null;
};

type MediaSource = NonNullable<BaseItemDto["MediaSources"]>[number];
type MediaStream = NonNullable<MediaSource["MediaStreams"]>[number];

const pickStream = (
  source: MediaSource,
  type: "Video" | "Audio",
  index?: number,
): MediaStream | undefined => {
  const streams = source.MediaStreams ?? [];
  if (index !== undefined)
    return streams.find((s) => s.Type === type && s.Index === index);
  return (
    streams.find((s) => s.Type === type && s.IsDefault) ??
    streams.find((s) => s.Type === type)
  );
};

// Probes <video>/<audio> capabilities once and builds a Jellyfin
// DeviceProfile that mirrors what the native Jellyfin web client sends.
// Sending this on PlaybackInfo lets Jellyfin decide DirectPlay vs
// transcode authoritatively — without it the server can't tell what we
// can decode and conservatively returns a transcode for anything that
// isn't a basic mp4. The codec-heuristic gate the client used before
// could not see proprietary codecs the browser actually supported
// (AC3/EAC3 in Chrome on macOS, HEVC in Safari/Chrome on Apple Silicon),
// which is why DirectPlay was being skipped on most MKV files.
let cachedDeviceProfile: DeviceProfile | null = null;

const buildDeviceProfile = (): DeviceProfile => {
  if (cachedDeviceProfile) return cachedDeviceProfile;

  const v = document.createElement("video");
  const a = document.createElement("audio");
  const cv = (mime: string) => v.canPlayType(mime) !== "";
  const ca = (mime: string) => a.canPlayType(mime) !== "";

  const videoCodecs: string[] = [];
  if (cv('video/mp4; codecs="avc1.42E01E"')) videoCodecs.push("h264");
  if (
    cv('video/mp4; codecs="hev1.1.6.L93.B0"') ||
    cv('video/mp4; codecs="hvc1.1.6.L93.B0"')
  )
    videoCodecs.push("hevc", "h265");
  if (cv('video/mp4; codecs="vp09.00.10.08"') || cv('video/webm; codecs="vp9"'))
    videoCodecs.push("vp9");
  if (cv('video/webm; codecs="vp8"')) videoCodecs.push("vp8");
  if (cv('video/mp4; codecs="av01.0.05M.08"')) videoCodecs.push("av1");

  const audioCodecs: string[] = [];
  if (ca('audio/mp4; codecs="mp4a.40.2"') || ca('audio/aac'))
    audioCodecs.push("aac");
  if (ca('audio/mpeg')) audioCodecs.push("mp3");
  if (ca('audio/flac') || ca('audio/x-flac')) audioCodecs.push("flac");
  if (ca('audio/ogg; codecs="opus"') || ca('audio/webm; codecs="opus"'))
    audioCodecs.push("opus");
  if (ca('audio/ogg; codecs="vorbis"') || ca('audio/webm; codecs="vorbis"'))
    audioCodecs.push("vorbis");
  // AC3/EAC3: Chromium on macOS plays these via the system decoder
  // (canPlayType returns "" for some Chrome builds even when playback
  // works). Advertise unconditionally — if the browser actually fails,
  // Player.tsx's onVideoError handler falls back to HLS.
  audioCodecs.push("ac3", "eac3");

  // Containers we advertise as direct-playable. Test the bare container
  // mime so codec strings don't false-negative on browsers that lie
  // (Safari returns "" for video/x-matroska but plays many MKVs fine
  // when codecs match). MP4 is universal; MKV gated on a positive probe.
  const mkvOk = cv("video/x-matroska") || cv("video/mp4");
  const webmOk = cv("video/webm");

  const directPlayProfiles: DirectPlayProfile[] = [
    {
      Type: DlnaProfileType.Video,
      Container: "mp4,m4v,mov",
      VideoCodec: videoCodecs.join(","),
      AudioCodec: audioCodecs.join(","),
    },
  ];
  if (mkvOk) {
    directPlayProfiles.push({
      Type: DlnaProfileType.Video,
      Container: "mkv",
      VideoCodec: videoCodecs.join(","),
      AudioCodec: audioCodecs.join(","),
    });
  }
  if (webmOk) {
    directPlayProfiles.push({
      Type: DlnaProfileType.Video,
      Container: "webm",
      VideoCodec: "vp8,vp9,av1",
      AudioCodec: "vorbis,opus",
    });
  }
  directPlayProfiles.push(
    { Type: DlnaProfileType.Audio, Container: "mp3", AudioCodec: "mp3" },
    { Type: DlnaProfileType.Audio, Container: "m4a,aac", AudioCodec: "aac" },
    { Type: DlnaProfileType.Audio, Container: "flac", AudioCodec: "flac" },
    { Type: DlnaProfileType.Audio, Container: "opus", AudioCodec: "opus" },
  );

  const profile: DeviceProfile = {
    Name: "Strata Browser",
    MaxStreamingBitrate: 120_000_000,
    MaxStaticBitrate: 200_000_000,
    DirectPlayProfiles: directPlayProfiles,
    TranscodingProfiles: [
      {
        Type: DlnaProfileType.Video,
        Container: "ts",
        Protocol: MediaStreamProtocol.Hls,
        VideoCodec: "h264",
        AudioCodec: "aac,mp3",
        Context: EncodingContext.Streaming,
        MaxAudioChannels: "6",
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
      {
        Type: DlnaProfileType.Audio,
        Container: "mp3",
        Protocol: MediaStreamProtocol.Http,
        AudioCodec: "mp3",
        Context: EncodingContext.Streaming,
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [
      { Format: "vtt", Method: SubtitleDeliveryMethod.External },
      { Format: "ass", Method: SubtitleDeliveryMethod.External },
      { Format: "ssa", Method: SubtitleDeliveryMethod.External },
      { Format: "srt", Method: SubtitleDeliveryMethod.External },
      { Format: "sub", Method: SubtitleDeliveryMethod.External },
      { Format: "pgssub", Method: SubtitleDeliveryMethod.External },
    ],
  };
  cachedDeviceProfile = profile;
  return profile;
};

export const buildStreamPlan = async (
  itemId: string,
  opts: { audioStreamIndex?: number; subtitleStreamIndex?: number } = {},
): Promise<StreamPlan> => {
  const userId = requireUserId();
  const res = await getMediaInfoApi(api).getPostedPlaybackInfo({
    itemId,
    userId,
    playbackInfoDto: {
      UserId: userId,
      AutoOpenLiveStream: true,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      MaxStreamingBitrate: 120_000_000,
      // Sending DeviceProfile is what makes Jellyfin's DirectPlay
      // decision authoritative — without it the server returns
      // SupportsDirectPlay=false for everything and clients fall back
      // to transcoding. The profile probes the browser's codec support
      // at runtime; see buildDeviceProfile() above.
      DeviceProfile: buildDeviceProfile(),
      ...(opts.audioStreamIndex !== undefined
        ? { AudioStreamIndex: opts.audioStreamIndex }
        : {}),
      ...(opts.subtitleStreamIndex !== undefined
        ? { SubtitleStreamIndex: opts.subtitleStreamIndex }
        : {}),
    },
  });
  const source = res.data.MediaSources?.[0];
  if (!source?.Id) throw new Error("Jellyfin returned no media source");
  const playSessionId = res.data.PlaySessionId ?? "";
  const token = api.accessToken ?? "";

  const videoStream = pickStream(source, "Video");
  // Source video bitrate caps the transcode target — preserves quality
  // when Jellyfin re-encodes. Falls back to a generous 20 Mbps if the
  // source doesn't report a bitrate.
  const sourceVideoBitrate =
    videoStream?.BitRate ?? source.Bitrate ?? 20_000_000;

  const directQs = new URLSearchParams({
    Static: "true",
    MediaSourceId: source.Id,
    api_key: token,
    PlaySessionId: playSessionId,
  });
  const directUrl = `${SERVER_URL}/Videos/${itemId}/stream?${directQs.toString()}`;

  // HLS targeting h264 high@5.1 + AAC. When the source already matches
  // (most h264 content), Jellyfin uses -c:v copy and quality is the
  // source bitstream untouched — no CPU spent re-encoding video. When
  // it can't (HEVC, Hi10P, etc.) it re-encodes at the source's own
  // bitrate so quality stays close to the original.
  //
  // TS segments + BreakOnNonKeyFrames=true is the canonical recipe for
  // stream-copy HLS: TS is self-contained (carries SPS/PPS in every
  // segment, so MSE can re-init after a seek), and allowing non-IDR
  // segment boundaries means Jellyfin doesn't have to re-encode just
  // to insert keyframes when the source GOP doesn't align with the
  // target segment duration.
  //
  // VideoStreamIndex pins the primary video — MKVs often carry a
  // secondary cover-art video stream that would otherwise leak into
  // the output and break MSE demuxing (`Got unexpected video track`).
  const hlsQs = new URLSearchParams({
    MediaSourceId: source.Id,
    PlaySessionId: playSessionId,
    api_key: token,
    VideoCodec: "h264",
    AudioCodec: "aac",
    TranscodingMaxAudioChannels: "6",
    SegmentContainer: "ts",
    MinSegments: "1",
    BreakOnNonKeyFrames: "true",
    "h264-level": "51",
    "h264-profile": "high",
    VideoBitrate: String(sourceVideoBitrate),
  });
  if (videoStream?.Index !== undefined) {
    hlsQs.set("VideoStreamIndex", String(videoStream.Index));
  }
  if (opts.audioStreamIndex !== undefined) {
    hlsQs.set("AudioStreamIndex", String(opts.audioStreamIndex));
  }
  if (opts.subtitleStreamIndex !== undefined) {
    hlsQs.set("SubtitleStreamIndex", String(opts.subtitleStreamIndex));
  }
  const fallbackHlsUrl = `${SERVER_URL}/Videos/${itemId}/master.m3u8?${hlsQs.toString()}`;

  // When DirectPlay isn't supported and Jellyfin returned its own
  // TranscodingUrl (built from the negotiated DeviceProfile), use it —
  // it has the correct per-source params (audio passthrough vs encode,
  // subtitle burn-in flags, etc.) that our hand-built URL can't infer.
  const serverTranscodeUrl = source.TranscodingUrl
    ? `${SERVER_URL}${source.TranscodingUrl}`
    : null;
  const hlsUrl = serverTranscodeUrl ?? fallbackHlsUrl;

  return {
    directUrl,
    hlsUrl,
    playSessionId,
    mediaSourceId: source.Id,
    // Trust Jellyfin's decision. With the DeviceProfile sent, the
    // server knows exactly what the browser can decode and sets this
    // flag authoritatively. If it's wrong (e.g. a codec the browser
    // advertised but can't actually play), Player.tsx's onVideoError
    // handler falls back to HLS via the existing path.
    preferHls: source.SupportsDirectPlay !== true,
    bitrate: videoStream?.BitRate ?? source.Bitrate ?? null,
  };
};

// Jellyfin can serve any text subtitle as WebVTT on demand. Attaching
// this URL to a <track> element lets us render subs on top of any
// playback path (direct or HLS) without forcing a video re-encode.
export const subtitleVttUrl = (
  itemId: string,
  mediaSourceId: string,
  streamIndex: number,
): string => {
  const token = api.accessToken ?? "";
  const qs = new URLSearchParams({ api_key: token });
  return `${SERVER_URL}/Videos/${itemId}/${mediaSourceId}/Subtitles/${streamIndex}/0/Stream.vtt?${qs.toString()}`;
};

export const reportPlaybackStart = async (
  itemId: string,
  playSessionId: string,
  mediaSourceId: string,
) => {
  await getPlaystateApi(api).reportPlaybackStart({
    playbackStartInfo: {
      ItemId: itemId,
      PlaySessionId: playSessionId,
      MediaSourceId: mediaSourceId,
      CanSeek: true,
    },
  });
};

export const reportPlaybackProgress = async (
  itemId: string,
  playSessionId: string,
  mediaSourceId: string,
  positionSeconds: number,
  isPaused: boolean,
) => {
  await getPlaystateApi(api).reportPlaybackProgress({
    playbackProgressInfo: {
      ItemId: itemId,
      PlaySessionId: playSessionId,
      MediaSourceId: mediaSourceId,
      PositionTicks: secondsToTicks(positionSeconds),
      IsPaused: isPaused,
      CanSeek: true,
    },
  });
};

export const reportPlaybackStopped = async (
  itemId: string,
  playSessionId: string,
  mediaSourceId: string,
  positionSeconds: number,
) => {
  await getPlaystateApi(api).reportPlaybackStopped({
    playbackStopInfo: {
      ItemId: itemId,
      PlaySessionId: playSessionId,
      MediaSourceId: mediaSourceId,
      PositionTicks: secondsToTicks(positionSeconds),
    },
  });
};

export { BaseItemKind, ImageType, type BaseItemDto };
