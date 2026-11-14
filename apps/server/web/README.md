# Strata dashboard

The admin dashboard that `strata-server` serves. It's React 19, Vite and TypeScript, with [shadcn/ui](https://ui.shadcn.com) components on Tailwind CSS v4. This file is for working on it.

## Quick start

```sh
bun install
bun run dev        # http://localhost:5173, proxies /api to http://localhost:8420
```

Run the server alongside it (`bun run dev` in `apps/server`). Set `STRATA_API` to proxy to a different server.

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Vite dev server on :5173 |
| `bun run build` | `tsc --noEmit && vite build` → `dist/` |
| `bun run typecheck` | `tsc --noEmit` |

You don't need to build it for a release: `apps/server/scripts/build.ts` runs `bun run build` here and embeds `dist/` in the server binary.

To try a build against a real server without touching your data, run this from `apps/server`:

```sh
bun src/main.ts --data-dir /tmp/strata-test --port 8431 --web-dir web/dist
```

## Adding a page

1. Create `src/features/<area>/<area>-page.tsx` with a default-exported component.
2. Add an entry to `routes` in `src/app/routes.tsx`, with a lucide icon and a nav group.
3. Add API calls to `lib/api.ts`, types to `lib/types.ts`, and a key to `queryKeys` in `lib/query.ts`.

The sidebar, top-bar title and code splitting all come from the route table.

## Layout

```
src/
  main.tsx                 providers: theme, TanStack Query, toasts
  index.css                Tailwind v4 + the Strata palette mapped onto shadcn tokens (light/dark)
  app/
    App.tsx                boot: /api/info → setup wizard | /invite/:id | sign-in | dashboard
    routes.tsx             the route table (path, title, icon, nav group, access, lazy page)
    app-layout.tsx         sidebar, top bar (household switcher, account menu), page outlet
    session.tsx            server info, /api/me, roles (`can`), auth-change refresh
  features/<area>/         one folder per admin area; pages are the default export
    overview/ library/ members/ devices/ link/ households/ settings/ logs/
    auth/ (sign-in, password) invite/ (public join page) setup/
  components/
    ui/                    shadcn/ui primitives (components.json); edit like any other source
    page.tsx               PageHeader, ErrorAlert, EmptyState, KeyValue, skeletons
    confirm-dialog.tsx     AlertDialog for destructive actions
    theme-provider.tsx     light / dark / system, class strategy, saved in localStorage
  lib/
    api.ts types.ts        the API client and response types (mirror apps/server/src/api/routes)
    auth-client.ts         every auth/session call, on Better Auth
    query.ts               QueryClient, query keys, useApiMutation (toasts + invalidation)
    router.tsx             tiny history router + <Link>
    format.ts utils.ts
```

## Who can see what

`/api/me` returns the account, its active household and its role. Each route's `access` is one of:

| Access | Who |
|---|---|
| `any` | Anyone signed in |
| `householdAdmin` | Owner or admin of the active household |
| `serverAdmin` | The setup account, also needing a household it runs (`/api/admin/*` is per household) |

Pages hide server-only fields (server name, TMDB key, transcoding, updates and so on) from household admins.

Switching account or household goes through `session.authChanged()`. It re-reads `/api/me`, drops every cached response and remounts the shell.

## Design decisions

- **Data fetching: TanStack Query.** The dashboard polls (status every 3 s, logs, update progress), refreshes other views after changes, and keeps paged library results while the next page loads. Query covers all of that (`refetchInterval`, `invalidateQueries`, `keepPreviousData`) for about 13 kB gzipped.
- **Auth behind one module.** Pages only call `authClient` (`lib/auth-client.ts`), a thin promise API over Better Auth's client (`better-auth/react` with the username, organization, admin, multi-session and device-authorization plugins). It throws `AuthError`, an `ApiError` with Better Auth's `code`.
- **Cookies, not headers.** Sessions are same-origin cookies, so `lib/api.ts` sends no auth header. `configureApiAuth` only reports 401s.
- **No router library.** A handful of flat pages and the server's index.html fallback don't need one. `lib/router.tsx` is about 50 lines; swapping in a router later only touches `app/`.
- **No table library.** Sorting, filtering and paging are done directly: server-side for the library, client-side for devices.
- **No form library.** Forms use shadcn's `Field` layout with plain state and inline validation messages.
- **Small entry bundle.** Every page and the setup wizard are `React.lazy` chunks. The entry chunk is React, Query and the shell.
