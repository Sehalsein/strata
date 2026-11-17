/**
 * The knowledge base (apps/docs). Pages link to the guide that covers them; the guides
 * live at the same paths with ".md" for assistants (see the docs' llms.txt).
 */
export const DOCS_URL = "https://docs.strata.sehalsein.com";

/** A guide's address, by its path on the docs site ("/addons/install"). */
export const docsUrl = (path = "/") => `${DOCS_URL}${path === "/" ? "" : path}`;

/** The guide for each settings section. */
export const SETTINGS_GUIDES: Record<string, string> = {
  general: "/addons/subtitles",
  library: "/library/folders",
  discovery: "/addons/order",
  addons: "/addons/install",
  pages: "/addons/pages",
  connections: "/library/connections",
  server: "/beyond/settings",
  network: "/beyond/remote",
  updates: "/get-started/install",
};
