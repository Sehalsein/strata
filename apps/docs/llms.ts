import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { Article } from "./src/articles";
import { articleMarkdown } from "./src/markdown";

/**
 * The docs for assistants (https://llmstxt.org): /llms.txt indexes every guide, each guide
 * has a Markdown copy at its path plus ".md", and /llms-full.txt is all of them in one file.
 * Built from the same articles, through the same converter as "Copy as Markdown".
 */

type Sections = { name: string; blurb: string; articles: Omit<Article, "section">[] }[];

export function articleFile(article: Omit<Article, "section">, site: string): string {
  const html = renderToStaticMarkup(
    createElement("article", null, createElement("h1", null, article.title), createElement("p", null, article.summary), createElement(article.body)),
  );
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return articleMarkdown(document.querySelector("article")!, { site, path: article.path, ext: ".md" });
}

export function llmsIndex(sections: Sections, site: string): string {
  const lines = [
    "# Strata Docs",
    "",
    "> Setup guides for Strata, a self-hosted media server with apps for iPhone, iPad, Mac and Apple TV: installing the server, adding media, connecting TMDB, TorBox and OMDb, Stremio add-ons, people and devices.",
    "",
    "Each link is the guide as Markdown. The same guide as a web page is at the same address without `.md`.",
    `Every guide in one file: ${site}/llms-full.txt`,
  ];
  for (const s of sections) {
    lines.push("", `## ${s.name}`, "", ...s.articles.map((a) => `- [${a.title}](${site}${a.path}.md): ${a.summary}`));
  }
  lines.push("", "## Optional", "", "- [Source code](https://github.com/Sehalsein/strata): the server, dashboard and apps", "- [Website](https://strata.sehalsein.com)");
  return `${lines.join("\n")}\n`;
}

export function llmsFull(sections: Sections, site: string): string {
  const parts = sections.flatMap((s) => s.articles.map((a) => articleFile(a, site)));
  return `# Strata Docs\n\nEvery guide, in reading order.\n\n---\n\n${parts.join("\n---\n\n")}`;
}

/** Every file to write, keyed by path under the site root. */
export function llmsFiles(sections: Sections, site: string): Record<string, string> {
  const files: Record<string, string> = { "llms.txt": llmsIndex(sections, site), "llms-full.txt": llmsFull(sections, site) };
  for (const a of sections.flatMap((s) => s.articles)) files[`${a.path.slice(1)}.md`] = articleFile(a, site);
  return files;
}
