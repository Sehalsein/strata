import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./routes/login";
import { HomePage } from "./routes/home";
import { MoviesPage } from "./routes/movies";
import { MovieDetailPage } from "./routes/movie-detail";
import { ShowsPage } from "./routes/shows";
import { ShowDetailPage } from "./routes/show-detail";
import { WatchPage } from "./routes/watch";
import { SearchPage } from "./routes/search";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const moviesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/movies",
  component: MoviesPage,
});

const movieDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/movies/$id",
  component: MovieDetailPage,
});

const showsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shows",
  component: ShowsPage,
});

const showDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shows/$id",
  component: ShowDetailPage,
});

const watchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/watch/$id",
  component: WatchPage,
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: SearchPage,
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  moviesRoute,
  movieDetailRoute,
  showsRoute,
  showDetailRoute,
  watchRoute,
  searchRoute,
]);

export const router = createRouter({ routeTree });
