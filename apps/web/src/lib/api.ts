import { Jellyfin } from "@jellyfin/sdk";
import type { Api } from "@jellyfin/sdk";
import { getItemsApi } from "@jellyfin/sdk/lib/utils/api/items-api";
import { getUserLibraryApi } from "@jellyfin/sdk/lib/utils/api/user-library-api";
import { getTvShowsApi } from "@jellyfin/sdk/lib/utils/api/tv-shows-api";
import { getMediaInfoApi } from "@jellyfin/sdk/lib/utils/api/media-info-api";
import { getPlaystateApi } from "@jellyfin/sdk/lib/utils/api/playstate-api";
import { getUserApi } from "@jellyfin/sdk/lib/utils/api/user-api";
import {
  BaseItemKind,
  ImageType,
  ItemFields,
  ItemSortBy,
  SortOrder,
  type BaseItemDto,
  type AuthenticationResult,
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

const getOrCreateDeviceId = (): string => {
  const existing = readStorage(STORAGE_DEVICE_ID);
  if (existing) return existing;
  const id = crypto.randomUUID();
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

  const directQs = new URLSearchParams({
    Static: "true",
    MediaSourceId: source.Id,
    api_key: token,
    PlaySessionId: playSessionId,
  });
  const directUrl = `${SERVER_URL}/Videos/${itemId}/stream?${directQs.toString()}`;

  const hlsQs = new URLSearchParams({
    MediaSourceId: source.Id,
    PlaySessionId: playSessionId,
    api_key: token,
    VideoCodec: "h264",
    AudioCodec: "aac",
    TranscodingMaxAudioChannels: "2",
    SegmentContainer: "mp4",
    MinSegments: "1",
    BreakOnNonKeyFrames: "True",
    "h264-level": "51",
    "h264-profile": "high",
  });
  if (opts.audioStreamIndex !== undefined) {
    hlsQs.set("AudioStreamIndex", String(opts.audioStreamIndex));
  }
  if (opts.subtitleStreamIndex !== undefined) {
    hlsQs.set("SubtitleStreamIndex", String(opts.subtitleStreamIndex));
  }
  const hlsUrl = `${SERVER_URL}/Videos/${itemId}/master.m3u8?${hlsQs.toString()}`;

  return {
    directUrl,
    hlsUrl,
    playSessionId,
    mediaSourceId: source.Id,
  };
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
