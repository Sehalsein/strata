import { useEffect } from "react";
import { ArrowRight, Blocks, Globe, Library, Puzzle, Rocket, Search, Users } from "lucide-react";
import { PosterWall } from "@/components/poster-wall";
import { GlassMark, Glow, Heading } from "../../landing/src/ui";
import { Reveal } from "../../landing/src/sections";
import { ARTICLES, SECTIONS } from "./articles";
import { navigate } from "./router";

const ICONS = { "Get started": Rocket, "Your library": Library, "Add-ons": Blocks, "Add-on guides": Puzzle, People: Users, "Beyond home": Globe } as Record<string, typeof Rocket>;

/** The way in: a hero like the landing site's, the quickest path, then every guide by section. */
export function Home() {
  useEffect(() => {
    document.title = "Strata Docs";
  }, []);
  const openSearch = () => dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  const path = ["/get-started/install", "/get-started/first-run", "/library/connections", "/addons/install", "/get-started/apps"];
  return (
    <>
      <section className="relative isolate overflow-hidden pt-36 pb-20 sm:pt-44">
        <PosterWall columns={8} className="absolute -inset-x-16 -top-24 bottom-0 -z-20 rotate-[-6deg] opacity-20" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#07080a]/40 via-[#07080a]/85 to-[#07080a]" />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-5 text-center sm:px-8">
          <div className="glass animate-in fade-in zoom-in-95 mb-8 flex size-16 items-center justify-center rounded-[1.3rem] duration-700">
            <GlassMark size={32} />
          </div>
          <h1 className="animate-in fade-in slide-in-from-bottom-3 text-5xl leading-[1.04] font-semibold tracking-tight text-balance duration-700 sm:text-7xl">
            Set up Strata, <span className="bg-gradient-to-b from-white to-white/55 bg-clip-text text-transparent">start to finish.</span>
          </h1>
          <p className="animate-in fade-in slide-in-from-bottom-4 mt-6 max-w-2xl text-lg text-pretty text-white/60 duration-700">
            Install the server, point it at your media, connect TMDB and TorBox, add add-ons, invite the house and sign in on every screen.
          </p>
          <button
            type="button"
            onClick={openSearch}
            className="glass animate-in fade-in slide-in-from-bottom-5 mt-10 flex h-14 w-full max-w-lg items-center gap-3 rounded-full px-5 text-left text-white/45 transition-colors duration-700 hover:text-white/70"
          >
            <Search className="size-5" />
            <span className="flex-1">Search the guides</span>
            <kbd className="glass-thin rounded-md px-2 py-0.5 font-sans text-xs">⌘K</kbd>
          </button>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <Glow className="-top-20 -left-40 size-[36rem]" color="rgba(120,140,255,0.12)" />
        <Reveal className="glass relative rounded-[1.75rem] p-6 sm:p-8">
          <p className="mb-1 text-xs font-semibold tracking-[0.18em] text-white/45 uppercase">The quickest way through</p>
          <p className="mb-6 text-white/60">
            Five guides, in order, and you're watching. No server?{" "}
            <a href="/get-started/cloud" onClick={(e) => (e.preventDefault(), navigate("/get-started/cloud"))} className="text-white underline-offset-4 hover:underline">
              Sign up for Strata Cloud
            </a>{" "}
            instead.
          </p>
          <ol className="grid gap-3 md:grid-cols-5">
            {path.map((p, i) => {
              const a = ARTICLES.find((x) => x.path === p);
              if (!a) return null;
              return (
                <li key={p}>
                  <a href={p} onClick={(e) => (e.preventDefault(), navigate(p))} className="glass-thin group flex h-full flex-col gap-3 rounded-2xl p-4 transition-colors hover:bg-white/[0.1]">
                    <span className="glass-solid flex size-7 items-center justify-center rounded-full text-xs font-semibold">{i + 1}</span>
                    <span className="font-medium text-white">{a.title}</span>
                    <span className="mt-auto flex items-center gap-1 text-xs text-white/45 group-hover:text-white/80">
                      Read <ArrowRight className="size-3" />
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        </Reveal>
      </section>

      <section className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <Heading eyebrow="Every guide" title="Find what you're setting up" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((section, i) => {
            const Icon = ICONS[section.name] ?? Rocket;
            return (
              <Reveal key={section.name} delay={i * 60} className="glass flex flex-col gap-4 rounded-[1.75rem] p-6">
                <div className="flex items-center gap-3">
                  <div className="glass-thin flex size-11 items-center justify-center rounded-2xl">
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">{section.name}</h3>
                    <p className="text-sm text-white/50">{section.blurb}</p>
                  </div>
                </div>
                <ul className="flex flex-col">
                  {section.articles.map((a) => (
                    <li key={a.path}>
                      <a href={a.path} onClick={(e) => (e.preventDefault(), navigate(a.path))} className="group flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white">
                        {a.title}
                        <ArrowRight className="size-3.5 text-white/30 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
                      </a>
                    </li>
                  ))}
                </ul>
              </Reveal>
            );
          })}
        </div>
      </section>
    </>
  );
}
