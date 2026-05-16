import { useMemo } from "react";
import { getAccessToken, getServerUrl, type BaseItemDto } from "@/lib/api";

export type TrickplayTile = {
  url: string;
  bgPos: { x: number; y: number };
  size: { w: number; h: number };
  thumb: { w: number; h: number };
};

export type TrickplaySource = {
  width: number;
  tileWidth: number;
  tileHeight: number;
  thumbW: number;
  thumbH: number;
  intervalMs: number;
  tileForTime: (seconds: number) => TrickplayTile;
};

/**
 * Builds a tile resolver from a Jellyfin item's Trickplay manifest. Returns
 * null when the server hasn't generated trickplay images for this item.
 * Picks the smallest available resolution — tooltips are ~160px wide so
 * the smallest tile is enough and cheapest to fetch.
 */
export const useTrickplay = (
  itemId: string,
  trickplay: BaseItemDto["Trickplay"] | undefined,
): TrickplaySource | null =>
  useMemo(() => {
    if (!trickplay) return null;
    const widths = Object.keys(trickplay)
      .map((k) => Number.parseInt(k, 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (widths.length === 0) return null;
    const width = widths[0]!;
    const intervals = trickplay[String(width)] ?? trickplay[width as unknown as string];
    if (!intervals) return null;
    const intervalKey = Object.keys(intervals)[0];
    if (!intervalKey) return null;
    const info = intervals[intervalKey];
    if (!info) return null;

    const thumbW = info.Width ?? 320;
    const thumbH = info.Height ?? 180;
    const tileW = info.TileWidth ?? 10;
    const tileH = info.TileHeight ?? 10;
    const intervalMs = info.Interval ?? 10_000;
    const perTile = tileW * tileH;
    const server = getServerUrl();
    const token = getAccessToken();

    const tileForTime = (seconds: number): TrickplayTile => {
      const safeSec = Math.max(0, seconds);
      const index = Math.floor((safeSec * 1000) / intervalMs);
      const tileIndex = Math.floor(index / perTile);
      const inTile = index % perTile;
      const col = inTile % tileW;
      const row = Math.floor(inTile / tileW);
      const qs = token ? `?api_key=${encodeURIComponent(token)}` : "";
      const url = `${server}/Videos/${itemId}/Trickplay/${width}/${tileIndex}.jpg${qs}`;
      return {
        url,
        bgPos: { x: -col * thumbW, y: -row * thumbH },
        size: { w: thumbW * tileW, h: thumbH * tileH },
        thumb: { w: thumbW, h: thumbH },
      };
    };

    return {
      width,
      tileWidth: tileW,
      tileHeight: tileH,
      thumbW,
      thumbH,
      intervalMs,
      tileForTime,
    };
  }, [itemId, trickplay]);
