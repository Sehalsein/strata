import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { UpdateError } from "../../update";
import { requireAdmin, requireAuth, type Env } from "../context";

/** Self-update. Mounted under /api/admin. */
export const systemRoutes = new Hono<Env>()
  .use("/update", requireAuth, requireAdmin)
  .use("/update/*", requireAuth, requireAdmin)

  .get("/update", (c) => c.json(c.var.services.updater.status()))

  .post("/update/check", async (c) => {
    try {
      return c.json(await c.var.services.updater.check());
    } catch (err) {
      // The failure is recorded in the status; return it so the dashboard can show it.
      if (err instanceof UpdateError && err.status === 409) throw new HTTPException(409, { message: err.message });
      return c.json(c.var.services.updater.status());
    }
  })

  .post("/update/apply", (c) => {
    try {
      c.var.services.updater.startApply();
    } catch (err) {
      if (err instanceof UpdateError) throw new HTTPException(err.status, { message: err.message });
      throw err;
    }
    return c.json(c.var.services.updater.status(), 202);
  });
