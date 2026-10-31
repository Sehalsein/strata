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
    App.tsx                boot: /api/info → setup wizard | sign-in | dashboard
    routes.tsx             the route table (path, title, icon, nav group, lazy page)
    app-layout.tsx         sidebar, top bar, user menu, page outlet
    session.tsx            server info + sign-out for the signed-in app
  features/<area>/         one folder per admin area; pages are the default export
    overview/ library/ profiles/ devices/ settings/ logs/ auth/ setup/
  components/
    ui/                    shadcn/ui primitives (components.json); edit like any other source
    page.tsx               PageHeader, ErrorAlert, EmptyState, KeyValue, skeletons
    confirm-dialog.tsx     AlertDialog for destructive actions
    theme-provider.tsx     light / dark / system, class strategy, saved in localStorage
  lib/
    api.ts types.ts        the API client and response types (mirror apps/server/src/api/routes)
    auth-client.ts         every auth/session call: setup, sign in/out, current user, password, token
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
- **Auth behind one module.** Pages and the shell only call `authClient` (`lib/auth-client.ts`):
  `hasSession`, `setupAdmin`, `signIn`, `signOut`, `getCurrentUser`, `changePassword`,
  `onSessionExpired`. It owns token storage and tells `lib/api.ts` how to authenticate requests
  (`configureApiAuth`). The server is moving to Better Auth (with organizations); that change
  re-implements this one file on `createAuthClient()` + `organizationClient()` from
  `better-auth/react` and leaves pages alone.
- **Routing: no router library.** Six flat pages and the server's index.html fallback don't need
  one. `lib/router.tsx` is ~50 lines; the route table is the one place pages are registered.
  If nested routes or loaders are ever needed, swapping in a router only touches `app/`.
- **Tables:** sorting, filtering and pagination are done directly (server-side for the library,
  client-side for devices) rather than through TanStack Table, which would add weight for two
  tables.
- **Forms:** shadcn's `Field` layout with plain state and inline validation messages; no form
  library, the forms are small.
- **Bundle:** every page and the setup wizard are `React.lazy` chunks; the entry chunk is React,
  Query and the shell.
