// A pass-through to AniList's GraphQL API for the cloud server: AniList blocks Cloudflare
// Workers' addresses, so the server sends its AniList requests here instead (see
// apps/server/src/catalog/anime/anilist.ts). Runs on Deno Deploy; see README.md.
//
// Only POSTs carrying RELAY_SECRET are passed on, so it isn't an open proxy. The server
// keeps the rate limit and the cache; this adds nothing but the hop.
const ANILIST = "https://graphql.anilist.co";
const secret = Deno.env.get("RELAY_SECRET");

/** Compares in constant time, so the secret can't be guessed a byte at a time. */
function same(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (!secret) return new Response("RELAY_SECRET isn't set", { status: 500 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!same(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  const res = await fetch(ANILIST, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Strata (+https://strata.sehalsein.com)" },
    body: await req.text(),
    signal: AbortSignal.timeout(15_000),
  });
  // AniList's status and rate-limit headers go back as they are, for the server's backoff.
  const headers = new Headers({ "Content-Type": res.headers.get("content-type") ?? "application/json" });
  for (const h of ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers });
});
