# Strata dashboard

The admin dashboard served by `strata-server`. React 19 + Vite + TypeScript, styled with
[shadcn/ui](https://ui.shadcn.com) components on Tailwind CSS v4. `apps/server/scripts/build.ts`
runs `bun run build` here and embeds `dist/` into the server binary.

```sh
bun install
bun run dev        # http://localhost:5173, proxies /api to http://localhost:8420 (STRATA_API overrides)
bun run build      # tsc --noEmit && vite build → dist/
```

To try a build against a real server without touching your data:
`bun ../src/main.ts --data-dir /tmp/strata-test --port 8431 --web-dir web/dist` (from `apps/server`).

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
    auth-client.ts         every auth/session call, on Better Auth: setup, sign in/up/out, accounts,
                           households, members, invitations, sessions, TV approval
    query.ts               QueryClient, query keys, useApiMutation (toasts + invalidation)
    router.tsx             tiny history router + <Link>
    format.ts utils.ts
```

### Adding a page

1. Create `src/features/<area>/<area>-page.tsx` with a default-exported component.
2. Add an entry to `routes` in `src/app/routes.tsx` (pick a lucide icon and a nav group).
3. Add API calls to `lib/api.ts`, types to `lib/types.ts`, and a key to `queryKeys` in `lib/query.ts`.

The sidebar, top-bar title and code splitting come from the route table.

## Decisions

- **Data fetching: TanStack Query.** The dashboard polls (status every 3 s, logs, update
  progress), mutates and then needs other views refreshed (a new TMDB key changes the Overview,
  renaming the server changes the sidebar), and keeps paged library results while the next page
  loads. A hand-rolled hook had grown its own polling, sequencing and refresh plumbing for this;
  Query covers all of it (visibility-aware `refetchInterval`, `invalidateQueries`,
  `keepPreviousData`) for ~13 kB gzipped, and new features get caching for free.
- **Auth behind one module.** Pages and the shell only call `authClient` (`lib/auth-client.ts`),
  a thin promise API over Better Auth's client (`better-auth/react` with the username,
  organization, admin, multi-session and device-authorization client plugins) that throws
  `AuthError` (an `ApiError` with Better Auth's `code`). Sessions are same-origin cookies, so
  `lib/api.ts` sends no auth header; `configureApiAuth` only reports 401s. Results are cached
  with TanStack Query like any other data.
- **Who can see what.** `/api/me` gives the account, its active household and role. A route's
  `access` is `any`, `householdAdmin` (owner/admin of the active household) or `serverAdmin`
  (the setup account, also needing a household it runs, since `/api/admin/*` is per household).
  Pages hide server-only fields (server name, TMDB key, transcoding, updates…) from household
  admins. Switching account or household goes through `session.authChanged()`, which re-reads
  `/api/me`, drops every cached response and remounts the shell.
- **Routing: no router library.** A handful of flat pages and the server's index.html fallback don't need
  one. `lib/router.tsx` is ~50 lines; the route table is the one place pages are registered.
  If nested routes or loaders are ever needed, swapping in a router only touches `app/`.
- **Tables:** sorting, filtering and pagination are done directly (server-side for the library,
  client-side for devices) rather than through TanStack Table, which would add weight for two
  tables.
- **Forms:** shadcn's `Field` layout with plain state and inline validation messages; no form
  library, the forms are small.
- **Bundle:** every page and the setup wizard are `React.lazy` chunks; the entry chunk is React,
  Query and the shell.
