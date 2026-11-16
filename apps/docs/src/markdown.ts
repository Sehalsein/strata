/**
 * An article as Markdown, read from its rendered HTML. The kit's pieces mark themselves
 * (data-md) where the HTML alone isn't enough, and decorations opt out (data-md-skip).
 * Works on the browser's DOM (Copy as Markdown) and on linkedom's (llms.txt, at build).
 */

type El = Element;
type Options = { link: (href: string) => string | null };

const BLOCK = /^(P|H[1-6]|UL|OL|TABLE|PRE|DIV|DL|SECTION|ARTICLE)$/;
const isEl = (n: Node): n is El => n.nodeType === 1;
const skip = (el: El) => el.hasAttribute("data-md-skip") || el.tagName.toUpperCase() === "SVG";

function inline(el: El, o: Options): string {
  return [...el.childNodes].map((n) => inlineNode(n, o)).join("");
}

function inlineNode(node: Node, o: Options): string {
  if (node.nodeType === 3) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (!isEl(node) || skip(node)) return "";
  if (node.getAttribute("data-md") === "path")
    return `**${[...node.querySelectorAll("[data-md-item]")].map((i) => i.textContent?.trim()).join(" › ")}**`;
  const text = inline(node, o);
  switch (node.tagName.toUpperCase()) {
    case "STRONG":
    case "B":
      return text.trim() ? `**${text.trim()}**` : "";
    case "EM":
    case "I":
      return `*${text.trim()}*`;
    case "CODE":
      return `\`${node.textContent}\``;
    case "KBD":
      return `\`${node.textContent}\``;
    case "A": {
      const href = node.getAttribute("href");
      const target = href ? o.link(href) : null;
      return target ? `[${text.trim()}](${target})` : text;
    }
    case "BR":
      return "\n";
    default:
      return text;
  }
}

function table(el: El, o: Options): string {
  const rows = [...el.querySelectorAll("tr")].map((r) => [...r.querySelectorAll("th, td")].map((c) => inline(c, o).trim().replace(/\|/g, "\\|")));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  const head = rows[0]!.every((c) => !c) ? Array.from({ length: width }, () => " ") : rows[0]!;
  return [line(head), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

function list(el: El, ordered: boolean, o: Options): string {
  const items = [...el.children]
    .filter((li) => !skip(li))
    .map((li, i) => {
      const marker = ordered ? `${i + 1}.` : "-";
      const [first = "", ...rest] = blocks(li, o).trim().split("\n");
      const pad = " ".repeat(marker.length + 1);
      return `${marker} ${first}${rest.length ? "\n" + rest.map((l) => (l ? pad + l : l)).join("\n") : ""}`;
    });
  // Loose (blank-line separated) when any item runs over several lines.
  return items.join(items.some((i) => i.includes("\n")) ? "\n\n" : "\n");
}

function block(el: El, o: Options): string {
  if (skip(el)) return "";
  const md = el.getAttribute("data-md");
  if (md === "callout")
    return blocks(el, o)
      .trim()
      .split("\n")
      .map((l) => (l ? `> ${l}` : ">"))
      .join("\n");
  if (md === "code") {
    const label = el.getAttribute("data-md-label");
    return `${label ? `${label}:\n\n` : ""}\`\`\`\n${el.querySelector("pre")?.textContent ?? ""}\n\`\`\``;
  }
  if (md === "facts")
    return [...el.querySelectorAll("dt")].map((dt) => `- **${dt.textContent?.trim()}:** ${dt.nextElementSibling ? inline(dt.nextElementSibling, o).trim() : ""}`).join("\n");
  switch (el.tagName.toUpperCase()) {
    case "H1":
      return `# ${inline(el, o).trim()}`;
    case "H2":
      return `## ${inline(el, o).trim()}`;
    case "H3":
      return `### ${inline(el, o).trim()}`;
    case "P":
      return inline(el, o).trim();
    case "UL":
      return list(el, false, o);
    case "OL":
      return list(el, true, o);
    case "TABLE":
      return table(el, o);
    case "PRE":
      return `\`\`\`\n${el.textContent}\n\`\`\``;
    default:
      return blocks(el, o);
  }
}

/** Block children, or inline text when an element holds no blocks. */
function blocks(el: El, o: Options): string {
  if (![...el.children].some((c) => BLOCK.test(c.tagName.toUpperCase()))) return inline(el, o).trim();
  return [...el.childNodes]
    .map((n) => (isEl(n) ? block(n, o) : (n.textContent ?? "").trim()))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The article element as Markdown. `site` is where links to other guides point;
 * `ext` is added to them (".md" in the llms files, so a reader stays in Markdown).
 */
export function articleMarkdown(article: El, { site, path, ext = "" }: { site: string; path: string; ext?: string }): string {
  const link = (href: string) => {
    if (href.startsWith("#")) return null;
    if (href.startsWith("/")) {
      const [p, hash] = href.split("#");
      return `${site}${p === "/" ? "/llms.txt" : `${p}${ext}`}${hash && !ext ? `#${hash}` : ""}`;
    }
    return href;
  };
  const body = blocks(article, { link }).replace(/\n{3,}/g, "\n\n").trim();
  return `${body}\n\nSource: ${site}${path}\n`;
}
