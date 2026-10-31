import type { ReactNode } from "react";
import { ArrowRight, Download, Laptop, Play, Server, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { Poster, PosterWall } from "@/components/poster-wall";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Faq, Reveal, Screens, Transform } from "./sections";
import { Features, Steps } from "./showcase";

const SOURCE_URL = "https://github.com/Sehalsein/strata";
/** The Mac app (the server, in the menu bar), and how to install on Linux. */
const MAC_DOWNLOAD = "https://github.com/Sehalsein/strata/releases/download/server-stable/Strata.dmg";
const LINUX_INSTALL = "https://github.com/Sehalsein/strata/blob/main/apps/server/README.md#install";
/** Some of the server's own profile pictures (this site passes /api through to it). */
const AVATARS = ["fox", "panda", "robot", "owl", "dino", "penguin"];

/** strata.sehalsein.com: what Strata is, and the way in. */
export function LandingPage() {
  return (
    <div className="bg-background min-h-svh overflow-x-clip">
      <Hero />
      <main>
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

function Nav() {
  return (
    <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
      <a href="/" className="flex items-center gap-2 font-semibold text-[#f5f3ef]">
        <BrandMark size={28} />
        <span className="text-lg">Strata</span>
      </a>
      <nav className="flex items-center gap-1 sm:gap-2">
        <a href="#install" className="hidden px-3 text-sm text-white/70 hover:text-white md:inline">
          Install
        </a>
        <a href={SOURCE_URL} className="hidden px-3 text-sm text-white/70 hover:text-white md:inline">
          Source
        </a>
        <a href="/privacy" className="hidden px-3 text-sm text-white/70 hover:text-white sm:inline">
          Privacy
        </a>
        <div className="dark">
          <ModeToggle />
        </div>
        <Button size="sm" asChild>
          <a href="#install">Download</a>
        </Button>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#0b0c0f] text-[#f5f3ef]">
      <PosterWall columns={7} className="absolute -inset-x-10 -top-24 bottom-0 rotate-[-6deg] opacity-35" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0b0c0f]/60 via-[#0b0c0f]/85 to-[#0b0c0f]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_70%_30%,rgba(243,146,86,0.25),transparent)]" />
      <Nav />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pt-10 pb-24 sm:px-8 lg:grid-cols-[1fr_1.15fr] lg:pt-16 lg:pb-32">
        <div className="flex flex-col items-start">
          <span className="animate-in fade-in slide-in-from-bottom-2 mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur duration-700">
            <Sparkles className="size-3.5 text-[#f6a574]" /> Free and open source
          </span>
          <h1 className="animate-in fade-in slide-in-from-bottom-3 text-5xl leading-[1.02] font-semibold tracking-tight text-balance duration-700 sm:text-7xl">
            Your media,{" "}
            <span className="bg-gradient-to-r from-[#f7c873] via-[#f39256] to-[#d2603f] bg-clip-text text-transparent">beautifully.</span>
          </h1>
          <p className="animate-in fade-in slide-in-from-bottom-4 mt-6 max-w-xl text-lg text-pretty text-white/65 duration-700 sm:text-xl">
            Strata turns the movies and shows you already have into a home screen worth sitting down to. Run it on your own Mac or Linux machine and watch on iPhone, iPad, Mac and Apple TV, with a profile for everyone in the house.
          </p>
          <div className="animate-in fade-in slide-in-from-bottom-5 mt-9 flex w-full flex-col gap-3 duration-700 sm:w-auto sm:flex-row">
            <Button size="lg" asChild className="h-12 px-6 text-base shadow-[0_0_40px_-8px_var(--primary)]">
              <a href={MAC_DOWNLOAD}>
                <Download /> Download for macOS
              </a>
            </Button>
            <Button size="lg" variant="outline" asChild className="h-12 border-white/20 bg-white/5 px-6 text-base text-white hover:bg-white/10 hover:text-white">
              <a href="#install">Other ways to install</a>
            </Button>
          </div>
          <div className="mt-8 flex items-center gap-3 text-sm text-white/55">
            <div className="flex -space-x-2">
              {AVATARS.slice(0, 4).map((a) => (
                <img key={a} src={`/api/avatars/${a}.png`} alt="" className="size-8 rounded-full ring-2 ring-[#0b0c0f]" />
              ))}
            </div>
            Free and open source. A profile for everyone at home.
          </div>
        </div>
        <Devices />
      </div>
    </section>
  );
}

/** The apps, drawn: an Apple TV home screen and an iPhone playing in front of it. */
function Devices() {
  return (
    <div className="animate-in fade-in zoom-in-95 relative mx-auto w-full max-w-xl duration-1000 lg:max-w-none" aria-hidden="true">
      <div className="absolute -inset-10 rounded-full bg-[radial-gradient(closest-side,rgba(243,146,86,0.28),transparent)] blur-2xl" />
      {/* The TV */}
      <div className="relative rounded-2xl border border-white/10 bg-[#111316] p-2 shadow-2xl shadow-black/60">
        <div className="relative overflow-hidden rounded-xl bg-[#0b0c0f]">
          <div className="relative aspect-[16/9]">
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #3b1d3a, #d2603f)" }} />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0b0c0f] via-[#0b0c0f]/60 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0b0c0f] via-transparent to-transparent" />
            <div className="absolute top-[14%] left-[5%] flex w-[48%] flex-col gap-2">
              <span className="w-fit rounded bg-white/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-white/80 uppercase">New episode</span>
              <div className="h-3 w-4/5 rounded-full bg-white/85 sm:h-4" />
              <div className="h-2 w-3/5 rounded-full bg-white/35" />
              <div className="mt-2 flex gap-1.5">
                <span className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[9px] font-semibold text-black sm:text-[10px]">
                  <Play className="size-2.5 fill-current" /> Resume
                </span>
                <span className="rounded-md bg-white/15 px-2 py-1 text-[9px] font-medium text-white sm:text-[10px]">My List</span>
              </div>
            </div>
            <div className="absolute inset-x-[5%] bottom-[7%]">
              <p className="mb-1.5 text-[9px] font-medium text-white/70 sm:text-[10px]">Continue Watching</p>
              <div className="grid grid-cols-6 gap-1.5">
                {[3, 8, 14, 21, 5, 11].map((seed, i) => (
                  <div key={seed} className={cn("relative", i === 0 && "ring-2 ring-white rounded-xl")}>
                    <Poster seed={seed} />
                    <div className="absolute inset-x-1.5 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-white/25">
                      <div className="h-full bg-[#f39256]" style={{ width: `${[72, 40, 15, 88, 55, 30][i]}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* The phone */}
      <div className="absolute -right-3 -bottom-14 w-[26%] rotate-[5deg] rounded-[1.6rem] border border-white/15 bg-[#111316] p-1.5 shadow-2xl shadow-black/70 sm:-right-6">
        <div className="relative aspect-[9/19] overflow-hidden rounded-[1.25rem] bg-[#0b0c0f]">
          <div className="absolute inset-x-0 top-0 h-[42%]" style={{ background: "linear-gradient(160deg, #0f3b3a, #f7c873)" }} />
          <div className="absolute inset-x-0 top-[22%] h-[20%] bg-gradient-to-t from-[#0b0c0f] to-transparent" />
          <div className="absolute inset-x-[8%] top-[46%] flex flex-col gap-1.5">
            <div className="h-1.5 w-4/5 rounded-full bg-white/80" />
            <div className="h-1 w-1/2 rounded-full bg-white/35" />
            <div className="mt-2 flex items-center gap-1 rounded-md bg-white px-1.5 py-1 text-[7px] font-semibold text-black">
              <Play className="size-2 fill-current" /> Play
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {[17, 2, 9].map((seed) => (
                <Poster key={seed} seed={seed} />
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* A profile, picked */}
      <div className="absolute -top-5 left-6 hidden items-center gap-2 rounded-full border border-white/10 bg-[#14161a]/90 py-1.5 pr-3 pl-1.5 text-xs text-white/85 shadow-xl backdrop-blur sm:flex">
        <img src="/api/avatars/fox.png" alt="" className="size-6 rounded-full" />
        Watching as Maya
      </div>
    </div>
  );
}

function Section({ id, eyebrow, title, lede, children, className }: { id?: string; eyebrow: string; title: string; lede?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("mx-auto max-w-6xl scroll-mt-8 px-5 py-20 sm:px-8 sm:py-28", className)}>
      <Reveal className="mb-12 max-w-2xl">
        <p className="text-brand-text mb-3 text-xs font-semibold tracking-[0.14em] uppercase">{eyebrow}</p>
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h2>
        {lede && <p className="text-muted-foreground mt-4 text-lg text-pretty">{lede}</p>}
      </Reveal>
      <Reveal delay={120}>{children}</Reveal>
    </section>
  );
}

/** Getting the server: the Mac app, Homebrew, or a Linux binary. */
function Install() {
  return (
    <Section id="install" eyebrow="Install" title="Up and running on your own machine" lede="The server runs at home, next to your files. The Strata apps on your iPhone, iPad, Mac and Apple TV find it on your network.">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-card relative flex flex-col gap-5 overflow-hidden rounded-3xl border p-7">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_80%_at_100%_0%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent)]" />
          <div className="relative flex items-center gap-3">
            <div className="bg-primary/12 text-brand-text flex size-11 items-center justify-center rounded-xl">
              <Laptop className="size-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Mac</h3>
              <p className="text-muted-foreground text-sm">Apple silicon, macOS 14 or later</p>
            </div>
          </div>
          <p className="text-muted-foreground relative text-sm leading-relaxed">Drag Strata to Applications and open it. It runs from the menu bar, starts at login and keeps itself up to date.</p>
          <div className="relative flex flex-col gap-3">
            <Button asChild className="w-fit">
              <a href={MAC_DOWNLOAD}>
                <Download /> Download Strata.dmg
              </a>
            </Button>
            <p className="text-muted-foreground text-xs">Or with Homebrew:</p>
            <pre className="bg-muted overflow-x-auto rounded-xl px-4 py-3 font-mono text-xs leading-relaxed">{`brew tap sehalsein/strata https://github.com/Sehalsein/strata
brew trust sehalsein/strata
brew install --cask strata`}</pre>
          </div>
        </div>
        <div className="bg-card flex flex-col gap-5 rounded-3xl border p-7">
          <div className="flex items-center gap-3">
            <div className="bg-primary/12 text-brand-text flex size-11 items-center justify-center rounded-xl">
              <Server className="size-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Linux</h3>
              <p className="text-muted-foreground text-sm">x64 and arm64</p>
            </div>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">A single binary that installs itself as a service, with the dashboard built in and updates available.</p>
          <div className="flex flex-col gap-3">
            <Button variant="outline" asChild className="w-fit">
              <a href={LINUX_INSTALL}>
                Install on Linux <ArrowRight />
              </a>
            </Button>
            <p className="text-muted-foreground text-xs">Or build it yourself:</p>
            <Button variant="ghost" asChild className="w-fit px-0">
              <a href={SOURCE_URL}>
                See the source on GitHub <ArrowRight />
              </a>
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

function Closing() {
  return (
    <section className="px-5 pb-20 sm:px-8 sm:pb-28">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[#0b0c0f] px-6 py-16 text-center text-[#f5f3ef] sm:py-24">
        <PosterWall columns={8} className="absolute -inset-x-10 -top-40 bottom-0 rotate-[-8deg] opacity-30" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_100%,rgba(243,146,86,0.35),transparent)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0b0c0f]/40 to-[#0b0c0f]/80" />
        <div className="relative flex flex-col items-center gap-6">
          <BrandMark size={44} />
          <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Tonight's movie is one tap away.</h2>
          <p className="max-w-lg text-white/65">Install Strata, add your media, invite the people you watch with, and press play.</p>
          <Button size="lg" asChild className="h-12 px-6 text-base shadow-[0_0_40px_-8px_var(--primary)]">
            <a href={MAC_DOWNLOAD}>
              <Download /> Download for macOS
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t">
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm sm:px-8 md:flex-row md:items-center md:justify-between">
        <div className="text-foreground flex items-center gap-2 font-semibold">
          <BrandMark size={20} /> Strata
          <span className="text-muted-foreground text-xs font-normal">© {new Date().getFullYear()} Sehal Sein</span>
        </div>
        <nav className="flex gap-6">
          <a href="#install" className="hover:text-foreground">
            Install
          </a>
          <a href={SOURCE_URL} className="hover:text-foreground">
            Source
          </a>
          <a href="/privacy" className="hover:text-foreground">
            Privacy
          </a>
        </nav>
      </div>
    </footer>
  );
}
