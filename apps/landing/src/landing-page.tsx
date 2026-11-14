import { ArrowRight, ChevronRight, Download, Info, Laptop, Play, Plus, Server } from "lucide-react";
import { Poster, PosterWall } from "@/components/poster-wall";
import { cn } from "@/lib/utils";
import { Faq, Reveal, Screens, Transform } from "./sections";
import { Features, Steps } from "./showcase";
import { GlassLink, GlassMark, Glow, Heading } from "./ui";

const SOURCE_URL = "https://github.com/Sehalsein/strata";
/** The Mac app (the server, in the menu bar), and how to install on Linux. */
const MAC_DOWNLOAD = "https://github.com/Sehalsein/strata/releases/download/server-stable/Strata.dmg";
const LINUX_INSTALL = "https://github.com/Sehalsein/strata/blob/main/apps/server/README.md#install";
/** Some of the server's own profile pictures (this site passes /api through to it). */
const AVATARS = ["fox", "panda", "robot", "owl", "dino", "penguin"];

/**
 * strata.sehalsein.com: what Strata is, and the way in. Dark and neutral like the apps,
 * in Liquid Glass: frosted surfaces over colour that drifts behind them.
 */
export function LandingPage() {
  return (
    <div className="dark min-h-svh overflow-x-clip bg-[#07080a] text-[#f5f3ef] antialiased">
      <Nav />
      <Hero />
      <main className="relative">
        <Screens />
        <Transform />
        <Steps />
        <Features />
        <Install />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}

/** A floating glass capsule, like the iPad's tab bar. */
function Nav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <nav className="glass pointer-events-auto flex items-center gap-1 rounded-full py-1.5 pr-1.5 pl-4">
        <a href="/" className="mr-2 flex items-center gap-2 font-semibold text-white">
          <GlassMark size={22} />
          <span>Strata</span>
        </a>
        {[
          ["Install", "#install"],
          ["Source", SOURCE_URL],
          ["Privacy", "/privacy"],
        ].map(([label, href]) => (
          <a key={label} href={href} className="hidden rounded-full px-3 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white sm:inline">
            {label}
          </a>
        ))}
        <GlassLink href="#install" solid size="sm" className="ml-1">
          Download
        </GlassLink>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-32 pb-24 sm:pt-40 lg:pb-32">
      {/* Artwork drifting behind everything, dimmed, for the glass to sit on. */}
      <PosterWall columns={8} className="absolute -inset-x-16 -top-24 bottom-0 -z-20 rotate-[-6deg] opacity-30" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#07080a]/40 via-[#07080a]/80 to-[#07080a]" />
      <Glow className="-top-40 left-1/2 -z-10 size-[56rem] -translate-x-1/2" color="rgba(130,150,255,0.18)" />
      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-5 text-center sm:px-8">
        <div className="animate-in fade-in zoom-in-95 mb-8 duration-700">
          <div className="glass flex size-20 items-center justify-center rounded-[1.6rem]">
            <GlassMark size={40} />
          </div>
        </div>
        <h1 className="animate-in fade-in slide-in-from-bottom-3 max-w-4xl text-5xl leading-[1.02] font-semibold tracking-tight text-balance duration-700 sm:text-7xl lg:text-8xl">
          Your media, <span className="bg-gradient-to-b from-white to-white/55 bg-clip-text text-transparent">beautifully.</span>
        </h1>
        <p className="animate-in fade-in slide-in-from-bottom-4 mt-7 max-w-2xl text-lg text-pretty text-white/60 duration-700 sm:text-xl">
          Strata turns the movies and shows you already have into a home screen worth sitting down to. Run it on your own Mac or Linux machine and watch on iPhone, iPad, Mac and Apple TV, with a profile for everyone in the house.
        </p>
        <div className="animate-in fade-in slide-in-from-bottom-5 mt-10 flex w-full flex-col items-center justify-center gap-3 duration-700 sm:flex-row">
          <GlassLink href={MAC_DOWNLOAD} solid size="lg" className="w-full sm:w-auto">
            <Download /> Download for macOS
          </GlassLink>
          <GlassLink href="#install" size="lg" className="w-full sm:w-auto">
            Other ways to install
          </GlassLink>
        </div>
        <div className="mt-8 flex items-center gap-3 text-sm text-white/50">
          <div className="flex -space-x-2">
            {AVATARS.slice(0, 4).map((a) => (
              <img key={a} src={`/api/avatars/${a}.png`} alt="" className="size-8 rounded-full ring-2 ring-[#07080a]" />
            ))}
          </div>
          Free and open source. A profile for everyone at home.
        </div>
        <Devices />
      </div>
    </section>
  );
}

/** The apps, drawn as they are now: the Apple TV home screen, and an iPhone in front of it. */
function Devices() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 relative mt-20 w-full max-w-5xl duration-1000" aria-hidden="true">
      <Glow className="-inset-x-20 -inset-y-10 -z-10" color="rgba(255,255,255,0.08)" />
      {/* The TV: a featured title, its glass buttons, and a row of posters. */}
      <div className="glass rounded-[1.75rem] p-2.5">
        <div className="relative overflow-hidden rounded-[1.25rem] bg-[#0b0c0f] text-left">
          {/* In flow, top to bottom, so nothing can overlap: the screen grows if it must. */}
          <div className="relative flex aspect-[16/9] flex-col justify-between gap-4 px-[5%] pt-[3%] pb-[5%] sm:gap-6">
            <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 90% at 75% 30%, #3d4f7a, #141a2b 55%, #0b0c0f)" }} />
            <div className="absolute top-[10%] right-[12%] size-[32%] rounded-full bg-[#9fb4ff]/25 blur-2xl" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0b0c0f] via-[#0b0c0f]/50 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0b0c0f] via-transparent to-transparent" />
            {/* The sidebar's corner button. */}
            <div className="glass-thin relative -ml-[2%] flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-semibold text-white sm:text-xs">
              <span className="text-white/60">‹</span> Home
            </div>
            <div className="relative flex w-[52%] flex-col gap-1.5 sm:gap-2.5">
              <span className="w-fit rounded-full border border-white/60 px-2 py-0.5 text-[8px] font-semibold text-white sm:text-[11px]">New Episode</span>
              <p className="text-lg leading-none font-bold tracking-tight sm:text-4xl">Northern Lines</p>
              <p className="text-[8px] font-medium text-white/80 sm:text-xs">TV Show · 2026 · ★ 8.4</p>
              <div className="hidden h-1.5 w-11/12 rounded-full bg-white/25 sm:block" />
              <div className="hidden h-1.5 w-3/4 rounded-full bg-white/15 sm:block" />
              <div className="mt-1 flex items-center gap-1.5 sm:mt-2 sm:gap-2.5">
                <span className="glass-solid flex items-center gap-1 rounded-full px-3 py-1 text-[9px] font-semibold whitespace-nowrap sm:px-6 sm:py-2 sm:text-sm">
                  <Play className="size-2.5 fill-current sm:size-3.5" /> Resume S2 · E5
                </span>
                {[Plus, Info, ChevronRight].map((Icon, i) => (
                  <span key={i} className="glass-thin flex size-5 items-center justify-center rounded-full sm:size-9">
                    <Icon className="size-2.5 sm:size-4" />
                  </span>
                ))}
              </div>
            </div>
            {/* Clear of the phone, which stands in front of the screen's right edge. */}
            <div className="relative md:pr-[16%]">
              <p className="mb-1.5 text-[8px] font-semibold text-white/80 sm:mb-2 sm:text-sm">Continue Watching</p>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 sm:gap-2.5 md:grid-cols-7">
                {[3, 8, 14, 21, 5, 11, 17].map((seed, i) => (
                  <div key={seed} className={cn("relative transition-transform", i === 0 && "z-10 scale-105 rounded-xl ring-2 ring-white/90 shadow-2xl shadow-black", i >= 4 && "hidden sm:block", i === 6 && "md:block sm:hidden")}>
                    <Poster seed={seed} />
                    <div className="absolute inset-x-1.5 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-white/25 sm:h-1">
                      <div className="h-full bg-white" style={{ width: `${[72, 40, 15, 88, 55, 30, 64, 20][i]}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* The phone. */}
      <div className="glass absolute -right-8 -bottom-16 hidden w-[19%] rotate-[4deg] rounded-[1.75rem] p-1.5 md:block">
        <div className="relative aspect-[9/19] overflow-hidden rounded-[1.4rem] bg-[#0b0c0f] text-left">
          <div className="absolute inset-x-0 top-0 h-[46%]" style={{ background: "linear-gradient(160deg, #20304f, #6d7fb8)" }} />
          <div className="absolute inset-x-0 top-[26%] h-[20%] bg-gradient-to-t from-[#0b0c0f] to-transparent" />
          <div className="absolute inset-x-[9%] top-[44%] flex flex-col gap-1.5">
            <p className="text-[9px] font-bold sm:text-sm">Paper Moons</p>
            <div className="h-1 w-1/2 rounded-full bg-white/35" />
            <div className="glass-solid mt-1.5 flex items-center justify-center gap-1 rounded-full py-1 text-[7px] font-semibold sm:text-[10px]">
              <Play className="size-2 fill-current" /> Play
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {[17, 2, 9].map((seed) => (
                <Poster key={seed} seed={seed} />
              ))}
            </div>
          </div>
          {/* Its floating tab bar. */}
          <div className="glass-thin absolute inset-x-[8%] bottom-[3%] flex justify-around rounded-full py-1 text-[6px] text-white/70 sm:text-[8px]">
            <span className="font-semibold text-white">Home</span>
            <span>Movies</span>
            <span>Shows</span>
          </div>
        </div>
      </div>
      {/* A profile, picked. */}
      <div className="glass absolute -top-5 left-6 hidden items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-xs text-white/90 sm:flex">
        <img src="/api/avatars/fox.png" alt="" className="size-6 rounded-full" />
        Watching as Maya
      </div>
    </div>
  );
}

/** Getting the server: the Mac app, Homebrew, or a Linux binary. */
function Install() {
  return (
    <section id="install" className="relative mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-28">
      <Glow className="top-10 -left-40 size-[36rem]" color="rgba(120,140,255,0.14)" />
      <Heading eyebrow="Install" title="Up and running on your own machine" lede="The server runs at home, next to your files. The Strata apps on your iPhone, iPad, Mac and Apple TV find it on your network." />
      <Reveal delay={120} className="grid gap-4 md:grid-cols-2">
        <div className="glass flex flex-col gap-5 rounded-[1.75rem] p-7">
          <div className="flex items-center gap-3">
            <div className="glass-thin flex size-11 items-center justify-center rounded-2xl">
              <Laptop className="size-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Mac</h3>
              <p className="text-sm text-white/50">Apple silicon, macOS 14 or later</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-white/60">Drag Strata to Applications and open it. It runs from the menu bar, starts at login and keeps itself up to date.</p>
          <div className="flex flex-col gap-3">
            <GlassLink href={MAC_DOWNLOAD} solid className="w-fit">
              <Download /> Download Strata.dmg
            </GlassLink>
            <p className="text-xs text-white/45">Or with Homebrew:</p>
            <pre className="glass-thin overflow-x-auto rounded-2xl px-4 py-3 font-mono text-xs leading-relaxed text-white/80">{`brew tap sehalsein/strata https://github.com/Sehalsein/strata
brew trust sehalsein/strata
brew install --cask strata`}</pre>
          </div>
        </div>
        <div className="glass flex flex-col gap-5 rounded-[1.75rem] p-7">
          <div className="flex items-center gap-3">
            <div className="glass-thin flex size-11 items-center justify-center rounded-2xl">
              <Server className="size-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Linux</h3>
              <p className="text-sm text-white/50">x64 and arm64</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-white/60">A single binary that installs itself as a service, with the dashboard built in and updates available.</p>
          <div className="flex flex-col items-start gap-3">
            <GlassLink href={LINUX_INSTALL}>
              Install on Linux <ArrowRight />
            </GlassLink>
            <p className="text-xs text-white/45">Or build it yourself:</p>
            <a href={SOURCE_URL} className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/80 hover:text-white">
              See the source on GitHub <ArrowRight className="size-4" />
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Closing() {
  return (
    <section className="px-5 pb-20 sm:px-8 sm:pb-28">
      <div className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-[2rem] px-6 py-16 text-center sm:py-24">
        <PosterWall columns={8} className="absolute -inset-x-10 -top-40 bottom-0 -z-20 rotate-[-8deg] opacity-40" />
        <div className="absolute inset-0 -z-10 bg-[#07080a]/55" />
        <div className="glass absolute inset-0 -z-10 rounded-[2rem]" />
        <div className="relative flex flex-col items-center gap-6">
          <div className="glass flex size-16 items-center justify-center rounded-[1.3rem]">
            <GlassMark size={32} />
          </div>
          <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Tonight's movie is one tap away.</h2>
          <p className="max-w-lg text-white/60">Install Strata, add your media, invite the people you watch with, and press play.</p>
          <GlassLink href={MAC_DOWNLOAD} solid size="lg">
            <Download /> Download for macOS
          </GlassLink>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm text-white/50 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 font-semibold text-white">
          <GlassMark size={18} /> Strata
          <span className="text-xs font-normal text-white/40">© {new Date().getFullYear()} Sehal Sein</span>
        </div>
        <nav className="flex gap-6">
          <a href="#install" className="hover:text-white">
            Install
          </a>
          <a href={SOURCE_URL} className="hover:text-white">
            Source
          </a>
          <a href="/privacy" className="hover:text-white">
            Privacy
          </a>
        </nav>
      </div>
    </footer>
  );
}
