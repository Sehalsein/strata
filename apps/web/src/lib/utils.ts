import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ImageType } from "@jellyfin/sdk/lib/generated-client/models";
import { getServerUrl, getAccessToken } from "./api";

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

const SIZE_TO_MAX_WIDTH: Record<string, number | undefined> = {
  w92: 92,
  w154: 154,
  w185: 185,
  w342: 342,
  w500: 500,
  w780: 780,
  original: undefined,
};

const buildImageUrl = (
  itemId: string | null | undefined,
  type: ImageType,
  size?: keyof typeof SIZE_TO_MAX_WIDTH,
  tag?: string | null,
): string | null => {
  if (!itemId) return null;
  const qs = new URLSearchParams();
  const maxWidth = size ? SIZE_TO_MAX_WIDTH[size] : undefined;
  if (maxWidth) qs.set("maxWidth", String(maxWidth));
  if (tag) qs.set("tag", tag);
  const token = getAccessToken();
  if (token) qs.set("api_key", token);
  const suffix = qs.toString();
  return `${getServerUrl()}/Items/${itemId}/Images/${type}${suffix ? `?${suffix}` : ""}`;
};

export const posterUrl = (
  itemId: string | null | undefined,
  size: keyof typeof SIZE_TO_MAX_WIDTH = "w342",
  tag?: string | null,
): string | null => buildImageUrl(itemId, ImageType.Primary, size, tag);

export const backdropUrl = (
  itemId: string | null | undefined,
  size: keyof typeof SIZE_TO_MAX_WIDTH = "original",
  tag?: string | null,
): string | null => buildImageUrl(itemId, ImageType.Backdrop, size, tag);

export const thumbUrl = (
  itemId: string | null | undefined,
  size: keyof typeof SIZE_TO_MAX_WIDTH = "w500",
  tag?: string | null,
): string | null => buildImageUrl(itemId, ImageType.Thumb, size, tag);

export const formatRuntime = (mins: number | null | undefined): string => {
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

export const formatTime = (totalSeconds: number): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

export const yearFrom = (item: {
  ProductionYear?: number | null;
  PremiereDate?: string | null;
}): string | null => {
  if (item.ProductionYear) return String(item.ProductionYear);
  if (item.PremiereDate) return item.PremiereDate.slice(0, 4);
  return null;
};
