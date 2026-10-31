import type { ReactNode } from "react";
import { ArrowRight, Baby, Clapperboard, Download, House, Lock, MonitorSmartphone, Server, Sparkles, Tv, UserPlus, Users, Zap } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { PosterWall } from "@/components/poster-wall";
import { Button } from "@/components/ui/button";

/** Where the app (the dashboard and the server the Strata apps talk to) lives. */
const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) ?? "https://app.strata.sehalsein.com";
const SOURCE_URL = "https://github.com/Sehalsein/strata";

/** strata.sehalsein.com: what Strata is, and the way in. */
export function LandingPage() {
  return (
    <div className="bg-background min-h-svh">
      <Hero />
      <main>
        <Steps />
        <Features />
        <SelfHost />
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
        <a href="/privacy" className="hidden px-3 text-sm text-white/70 hover:text-white sm:inline">
          Privacy
        </a>
        <div className="dark">
          <ModeToggle />
        </div>
        <Button variant="ghost" size="sm" asChild className="text-white/85 hover:bg-white/10 hover:text-white">
          <a href={APP_URL}>Sign in</a>
        </Button>
        <Button size="sm" asChild>
          <a href={`${APP_URL}/signup`}>Get started</a>
        </Button>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#0b0c0f]">
      <PosterWall columns={6} className="absolute -inset-x-10 -top-24 bottom-0 rotate-[-6deg] opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0b0c0f]/70 via-[#0b0c0f]/80 to-[#0b0c0f]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,rgba(243,146,86,0.22),transparent)]" />
      <Nav />
      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-5 pt-16 pb-28 text-center sm:px-8 sm:pt-24 sm:pb-36">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
          <Sparkles className="size-3.5 text-[#f6a574]" /> Strata Cloud
        </span>
        <h1 className="text-5xl leading-[1.05] font-semibold tracking-tight text-balance text-[#f5f3ef] sm:text-7xl">Your own streaming service.</h1>
        <p className="mt-6 max-w-2xl text-lg text-pretty text-white/65 sm:text-xl">
          Every movie and show from TMDB, playing from your own TorBox library, on iPhone, iPad, Mac and Apple TV. One place for the whole household, with a profile for everyone.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" asChild className="h-12 px-6 text-base">
            <a href={`${APP_URL}/signup`}>
              Create your household <ArrowRight />
            </a>
          </Button>
          <Button size="lg" variant="outline" asChild className="h-12 border-white/20 bg-white/5 px-6 text-base text-white hover:bg-white/10 hover:text-white">
            <a href={APP_URL}>Sign in</a>
          </Button>
        </div>
        <p className="mt-5 text-sm text-white/45">Free. Bring your own TMDB and TorBox keys.</p>
      </div>
    </section>
  );
}

function Section({ eyebrow, title, lede, children }: { eyebrow: string; title: string; lede?: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
      <div className="mb-12 max-w-2xl">
        <p className="text-brand-text mb-3 text-xs font-semibold tracking-[0.14em] uppercase">{eyebrow}</p>
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
        {lede && <p className="text-muted-foreground mt-4 text-lg text-pretty">{lede}</p>}
      </div>
      {children}
    </section>
  );
}

function Steps() {
  const steps = [
    { icon: House, title: "Create your household", body: "Sign up with your email or Google. Your household gets its own library, keys and settings." },
    { icon: Clapperboard, title: "Connect TMDB and TorBox", body: "A free TMDB key builds the catalog; your TorBox library is what plays. Keys are stored encrypted, for your household only." },
    { icon: Tv, title: "Watch everywhere", body: "Open the Strata app on iPhone, iPad, Mac or Apple TV and pick up where you left off on any of them." },
  ];
  return (
    <Section eyebrow="How it works" title="Up and running in a few minutes">
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="bg-card relative flex flex-col gap-4 rounded-2xl border p-6">
            <div className="flex items-center justify-between">
              <div className="bg-primary/12 text-brand-text flex size-11 items-center justify-center rounded-xl">
                <s.icon className="size-5" />
              </div>
              <span className="text-muted-foreground/50 text-4xl font-semibold tabular-nums">{i + 1}</span>
            </div>
            <h3 className="text-lg font-semibold">{s.title}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Features() {
  const features = [
    { icon: Zap, title: "Straight to your device", body: "Video streams from TorBox to the device that's playing it; nothing in between slows it down." },
    { icon: MonitorSmartphone, title: "One player, everywhere", body: "Picture in Picture, AirPlay and subtitles on iPhone and iPad, the same player on Apple TV." },
    { icon: Tv, title: "Made for the big screen", body: "Apple TV matches the video's frame rate and dynamic range, and signs in with a code you scan with your phone." },
    { icon: Users, title: "A profile for everyone", body: "Everyone you invite gets their own progress, Continue Watching and My List." },
    { icon: Baby, title: "Kids profiles", body: "Set an age limit per profile; titles above it don't show up anywhere." },
    { icon: Download, title: "Downloads", body: "Save movies and episodes on iPhone and iPad and watch them offline." },
    { icon: UserPlus, title: "Invite-only households", body: "People join your household by a link you send them. You decide who's in." },
    { icon: Lock, title: "Private by design", body: "No ads, no analytics, no tracking, and nothing is sold. Your keys are encrypted and only used for your household." },
  ];
  return (
    <div className="bg-muted/30 border-y">
      <Section eyebrow="Features" title="Everything a streaming service should do" lede="Strata gives your household the parts that make streaming services pleasant, on top of a library that's yours.">
        <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <li key={f.title} className="flex flex-col gap-3">
              <f.icon className="text-brand-text size-6" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{f.body}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function SelfHost() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
      <div className="bg-card relative overflow-hidden rounded-3xl border p-8 sm:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_100%_0%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent)]" />
        <div className="relative flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl space-y-3">
            <div className="bg-primary/12 text-brand-text flex size-11 items-center justify-center rounded-xl">
              <Server className="size-5" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Rather run it at home?</h2>
            <p className="text-muted-foreground text-pretty">
              Strata is open source. Run your own server on a Mac or Linux box, add folders of your own files, and the same apps connect to it on your home network.
            </p>
          </div>
          <Button variant="outline" size="lg" asChild>
            <a href={SOURCE_URL}>
              See the source <ArrowRight />
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
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm sm:px-8 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="text-foreground flex items-center gap-2 font-semibold">
            <BrandMark size={20} /> Strata
          </div>
          <p className="max-w-md text-xs">
            Movie and show data from{" "}
            <a href="https://www.themoviedb.org" className="underline">
              TMDB
            </a>
            . This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </div>
        <nav className="flex gap-6">
          <a href={APP_URL} className="hover:text-foreground">
            Sign in
          </a>
          <a href={`${APP_URL}/signup`} className="hover:text-foreground">
            Get started
          </a>
          <a href="/privacy" className="hover:text-foreground">
            Privacy
          </a>
        </nav>
      </div>
    </footer>
  );
}
