import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { avatarPng, avatarSections } from "../../avatars";
import type { Env } from "../context";

// Profile pictures, public: they're the same for everyone and Who's watching shows them
// before anyone signs in. A picture never changes once published (a new look gets a new id).
export const avatarRoutes = new Hono<Env>()
  .get("/avatars", (c) => c.json({ groups: avatarSections }, 200, { "Cache-Control": "public, max-age=3600" }))
  .get("/avatars/:file{[a-z0-9-]+\\.png}", (c) => {
    const png = avatarPng(c.req.param("file").slice(0, -".png".length));
    if (!png) throw new HTTPException(404, { message: "No such picture" });
    return c.body(png, 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" });
  });
