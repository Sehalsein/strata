import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, FileText, Menu, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassLink, GlassMark, Glow } from "../../landing/src/ui";
import { ARTICLES, SECTIONS, type Article } from "./articles";
import { A } from "./kit";
import { articleMarkdown } from "./markdown";
import { navigate } from "./router";

export const SITE_URL = "https://strata.sehalsein.com";
/** Where this site lives; links in the Markdown copies point here. */
export const DOCS_URL = "https://docs.strata.sehalsein.com";
export const SOURCE_URL = "https://github.com/Sehalsein/strata";

/** Same page, same background as the landing site: near-black, with colour drifting behind the glass. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="dark relative min-h-svh overflow-x-clip bg-[#07080a] text-[#f5f3ef] antialiased">
      <Glow className="-top-60 left-1/3 -z-0 size-[60rem]" color="rgba(130,150,255,0.10)" />
      <Glow className="top-[40rem] -right-80 -z-0 size-[44rem]" color="rgba(242,160,90,0.06)" />
      <Nav />
      <div className="relative">{children}</div>
      <Footer />
    </div>
  );
}

function InternalLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} className={className} onClick={(e) => (e.preventDefault(), navigate(href))}>
      {children}
    </a>
  );
}

/** The landing site's floating capsule, with search in it. */
function Nav() {
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault();
        setSearching(true);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
        <nav className="glass pointer-events-auto flex items-center gap-1 rounded-full py-1.5 pr-1.5 pl-4">
          <InternalLink href="/" className="mr-1 flex items-center gap-2 font-semibold text-white">
            <GlassMark size={22} />
            <span>Strata</span>
            <span className="font-normal text-white/45">Docs</span>
          </InternalLink>
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="glass-thin ml-2 flex h-9 items-center gap-2 rounded-full px-3 text-sm text-white/55 transition-colors hover:text-white"
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded border border-white/15 px-1.5 font-sans text-[10px] text-white/40 md:inline">⌘K</kbd>
          </button>
          {[
            ["Website", SITE_URL],
            ["Source", SOURCE_URL],
          ].map(([label, href]) => (
            <a key={label} href={href} className="hidden rounded-full px-3 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white md:inline">
              {label}
            </a>
          ))}
          <GlassLink href="/get-started/install" solid size="sm" className="ml-1">
            Set up
          </GlassLink>
        </nav>
      </header>
      {searching && <SearchDialog onClose={() => setSearching(false)} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return ARTICLES;
    return ARTICLES.map((a) => {
      const hay = `${a.title} ${a.summary} ${a.keywords ?? ""} ${a.section}`.toLowerCase();
      const title = a.title.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      return { a, score: words.reduce((s, w) => s + (title.includes(w) ? 2 : 1), 0) };
    })
      .filter((r): r is { a: Article; score: number } => r !== null)
      .sort((x, y) => y.score - x.score)
      .map((r) => r.a);
  }, [q]);
  const go = (a: Article | undefined) => {
    if (!a) return;
    onClose();
    navigate(a.path);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div className="glass animate-in fade-in zoom-in-95 w-full max-w-xl overflow-hidden rounded-[1.5rem] duration-150" style={{ backgroundColor: "rgba(18,20,26,0.85)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/10 px-5">
          <Search className="size-4 shrink-0 text-white/50" />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setActive(0))}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") (e.preventDefault(), setActive((i) => Math.min(i + 1, results.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setActive((i) => Math.max(i - 1, 0)));
              if (e.key === "Enter") go(results[active]);
            }}
            placeholder="Search the guides: TorBox, add-ons, invite…"
            className="h-14 flex-1 bg-transparent text-white outline-none placeholder:text-white/35"
          />
          <button type="button" onClick={onClose} aria-label="Close" className="text-white/50 hover:text-white">
            <X className="size-4" />
          </button>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-4 py-8 text-center text-sm text-white/45">Nothing matches “{q}”.</li>}
          {results.map((a, i) => (
            <li key={a.path}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(a)}
                className={cn("flex w-full flex-col items-start gap-0.5 rounded-xl px-4 py-2.5 text-left", i === active && "bg-white/[0.08]")}
              >
                <span className="text-[11px] font-medium tracking-wide text-white/40 uppercase">{a.section}</span>
                <span className="font-medium text-white">{a.title}</span>
                <span className="line-clamp-1 text-sm text-white/50">{a.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Sidebar({ current, onPick }: { current: string; onPick?: () => void }) {
  return (
    <nav className="flex flex-col gap-7">
      {SECTIONS.map((section) => (
        <div key={section.name}>
          <p className="mb-2 px-3 text-xs font-semibold tracking-[0.14em] text-white/40 uppercase">{section.name}</p>
          <ul className="flex flex-col gap-0.5">
            {section.articles.map((a) => (
              <li key={a.path}>
                <InternalLink
                  href={a.path}
                  className={cn(
                    "block rounded-xl px-3 py-1.5 text-sm transition-colors",
                    a.path === current ? "glass-thin font-medium text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white",
                  )}
                >
                  <span onClick={onPick}>{a.title}</span>
                </InternalLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** "On this page": the article's sections, the current one lit as you scroll. */
function Toc({ path }: { path: string }) {
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);
  const [active, setActive] = useState<string>();
  useEffect(() => {
    const heads = [...document.querySelectorAll<HTMLElement>("article [data-toc]")];
    setItems(heads.map((h) => ({ id: h.id, text: h.textContent?.replace(/#$/, "") ?? "" })));
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-90px 0px -65% 0px" },
    );
    heads.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [path]);
  if (items.length < 2) return null;
  return (
    <div>
      <p className="mb-3 text-xs font-semibold tracking-[0.14em] text-white/40 uppercase">On this page</p>
      <ul className="flex flex-col gap-1 border-l border-white/10">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={(e) => (e.preventDefault(), navigate(`#${item.id}`))}
              className={cn("-ml-px block border-l py-1 pl-3.5 text-sm transition-colors", active === item.id ? "border-white text-white" : "border-transparent text-white/50 hover:text-white")}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** An article: the sidebar, the text in the middle, and where you are on the right. */
export function ArticlePage({ article }: { article: Article }) {
  const [menu, setMenu] = useState(false);
  const body = useRef<HTMLElement>(null);
  const index = ARTICLES.indexOf(article);
  const prev = ARTICLES[index - 1];
  const next = ARTICLES[index + 1];
  const Body = article.body;
  useEffect(() => {
    document.title = `${article.title} · Strata Docs`;
  }, [article]);
  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-5 pt-28 pb-24 sm:px-8 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem]">
      <aside className="hidden lg:block">
        <div className="sticky top-28 max-h-[calc(100svh-8rem)] overflow-y-auto pr-2 pb-8">
          <Sidebar current={article.path} />
        </div>
      </aside>

      <div className="min-w-0">
        <button type="button" onClick={() => setMenu(true)} className="glass-thin mb-6 flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white/80 lg:hidden">
          <Menu className="size-4" /> All guides
        </button>
        <article ref={body} className="max-w-3xl">
          <div data-md-skip className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold tracking-[0.18em] text-white/45 uppercase">{article.section}</p>
            <MarkdownActions article={article} body={body} />
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-white sm:text-5xl">{article.title}</h1>
          <p className="mt-4 mb-10 text-lg text-pretty text-white/60">{article.summary}</p>
          <Body />
        </article>
        <div className="mt-16 grid max-w-3xl gap-3 sm:grid-cols-2">
          {prev ? <Pager article={prev} dir="prev" /> : <span />}
          {next && <Pager article={next} dir="next" />}
        </div>
      </div>

      <aside className="hidden xl:block">
        <div className="sticky top-28">
          <Toc path={article.path} />
        </div>
      </aside>

      {menu && (
        <div className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMenu(false)}>
          <div className="glass animate-in slide-in-from-left absolute inset-y-3 left-3 w-72 overflow-y-auto rounded-[1.5rem] p-4 pt-5 duration-200" style={{ backgroundColor: "rgba(18,20,26,0.92)" }} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setMenu(false)} aria-label="Close" className="absolute top-4 right-4 text-white/50 hover:text-white">
              <X className="size-4" />
            </button>
            <Sidebar current={article.path} onPick={() => setMenu(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Copy the article as Markdown (for notes, or an assistant), or open its .md copy. */
function MarkdownActions({ article, body }: { article: Article; body: RefObject<HTMLElement | null> }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!body.current) return;
    const md = articleMarkdown(body.current, { site: location.origin, path: article.path });
    navigator.clipboard?.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={copy} className="glass-thin flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-white/75 transition-colors hover:text-white">
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy as Markdown"}
      </button>
      <a href={`${article.path}.md`} target="_blank" rel="noreferrer" title="View as Markdown" className="glass-thin flex size-8 items-center justify-center rounded-full text-white/75 transition-colors hover:text-white">
        <FileText className="size-3.5" />
      </a>
    </div>
  );
}

function Pager({ article, dir }: { article: Article; dir: "prev" | "next" }) {
  return (
    <InternalLink href={article.path} className={cn("glass group flex flex-col gap-1 rounded-2xl px-5 py-4 transition-colors hover:bg-white/[0.08]", dir === "next" && "items-end text-right sm:col-start-2")}>
      <span className="flex items-center gap-1.5 text-xs text-white/45">
        {dir === "prev" ? <ArrowLeft className="size-3.5" /> : null}
        {dir === "prev" ? "Previous" : "Next"}
        {dir === "next" ? <ArrowRight className="size-3.5" /> : null}
      </span>
      <span className="font-medium text-white">{article.title}</span>
    </InternalLink>
  );
}

export function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70svh] max-w-xl flex-col items-center justify-center gap-5 px-5 pt-28 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">This page isn't here</h1>
      <p className="text-white/60">
        It may have moved. Try the <A href="/">guides</A>, or press <kbd className="glass-thin rounded px-1.5 text-sm">⌘K</kbd> to search.
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="relative border-t border-white/10">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 text-sm text-white/50 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 font-semibold text-white">
          <GlassMark size={18} /> Strata Docs
          <span className="text-xs font-normal text-white/40">© {new Date().getFullYear()} Sehal Sein</span>
        </div>
        <nav className="flex gap-6">
          <a href={SITE_URL} className="hover:text-white">
            Website
          </a>
          <a href={`${SITE_URL}/privacy`} className="hover:text-white">
            Privacy
          </a>
          <a href={SOURCE_URL} className="hover:text-white">
            Source
          </a>
        </nav>
      </div>
    </footer>
  );
}
