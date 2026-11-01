import { avatarCatalog, avatarGroups } from "./catalog.generated";

/**
 * Strata's profile pictures: original characters drawn for Strata (scripts/avatars), built
 * into the server and served at /api/avatars. A person's choice is kept in their Better
 * Auth `image` as the picture's path, so every client shows it the same way.
 */
export const AVATAR_PATH = "/api/avatars/";

export const avatars = avatarCatalog.map(({ id, name, background }) => ({ id, name, background, url: `${AVATAR_PATH}${id}.png` }));

const byId = new Map(avatars.map((a) => [a.id, a]));

/** The pictures in the groups the pickers show them in. */
export const avatarSections = avatarGroups.map((g) => ({ title: g.title, avatars: g.ids.map((id) => byId.get(id)!) }));

const pngs = new Map(avatarCatalog.map((a) => [a.id, a.png]));

export function avatarPng(id: string): Uint8Array<ArrayBuffer> | null {
  const png = pngs.get(id);
  return png ? (Uint8Array.from(atob(png), (ch) => ch.charCodeAt(0)) as Uint8Array<ArrayBuffer>) : null;
}

/** Whether `image` is one of the pictures here (the only kind a profile may have). */
export function isAvatarImage(image: unknown): boolean {
  if (typeof image !== "string" || !image.startsWith(AVATAR_PATH) || !image.endsWith(".png")) return false;
  return pngs.has(image.slice(AVATAR_PATH.length, -".png".length));
}
