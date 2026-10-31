import type { ReactNode } from "react";
import { ArrowRight, Baby, Check, Cloud, Download, Lock, Minus, Play, Server, Sparkles, Tv, UserPlus, Zap } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { Poster, PosterWall } from "@/components/poster-wall";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Faq, Reveal, Screens, Transform } from "./sections";

/** Where the app (the dashboard and the server the Strata apps talk to) lives. */
const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) ?? "https://app.strata.sehalsein.com";
const SOURCE_URL = "https://github.com/Sehalsein/strata";
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
        <Compare />
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
        <a href="#compare" className="hidden px-3 text-sm text-white/70 hover:text-white md:inline">
          Cloud or at home
        </a>
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
    <section className="relative overflow-hidden bg-[#0b0c0f] text-[#f5f3ef]">
      <PosterWall columns={7} className="absolute -inset-x-10 -top-24 bottom-0 rotate-[-6deg] opacity-35" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0b0c0f]/60 via-[#0b0c0f]/85 to-[#0b0c0f]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_70%_30%,rgba(243,146,86,0.25),transparent)]" />
      <Nav />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pt-10 pb-24 sm:px-8 lg:grid-cols-[1fr_1.15fr] lg:pt-16 lg:pb-32">
        <div className="flex flex-col items-start">
          <span className="animate-in fade-in slide-in-from-bottom-2 mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur duration-700">
            <Sparkles className="size-3.5 text-[#f6a574]" /> Strata Cloud is here
          </span>
          <h1 className="animate-in fade-in slide-in-from-bottom-3 text-5xl leading-[1.02] font-semibold tracking-tight text-balance duration-700 sm:text-7xl">
            Your media,{" "}
            <span className="bg-gradient-to-r from-[#f7c873] via-[#f39256] to-[#d2603f] bg-clip-text text-transparent">beautifully.</span>
          </h1>
          <p className="animate-in fade-in slide-in-from-bottom-4 mt-6 max-w-xl text-lg text-pretty text-white/65 duration-700 sm:text-xl">
            Strata turns the movies and shows you already have into a home screen worth sitting down to, on iPhone, iPad, Mac and Apple TV. Artwork, details, resume anywhere, and a profile for everyone in the house.
          </p>
          <div className="animate-in fade-in slide-in-from-bottom-5 mt-9 flex w-full flex-col gap-3 duration-700 sm:w-auto sm:flex-row">
            <Button size="lg" asChild className="h-12 px-6 text-base shadow-[0_0_40px_-8px_var(--primary)]">
              <a href={`${APP_URL}/signup`}>
                Create your household <ArrowRight />
              </a>
            </Button>
            <Button size="lg" variant="outline" asChild className="h-12 border-white/20 bg-white/5 px-6 text-base text-white hover:bg-white/10 hover:text-white">
              <a href={APP_URL}>Sign in</a>
            </Button>
          </div>
          <div className="mt-8 flex items-center gap-3 text-sm text-white/55">
            <div className="flex -space-x-2">
              {AVATARS.slice(0, 4).map((a) => (
                <img key={a} src={`/api/avatars/${a}.png`} alt="" className="size-8 rounded-full ring-2 ring-[#0b0c0f]" />
              ))}
            </div>
            Free to get started. A profile for everyone at home.
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

function Steps() {
  const steps = [
    { title: "Create your household", body: "Sign up with your email or Google. Your household gets its own library and settings." },
    { title: "Bring your media", body: "Connect where your movies and shows live. Strata recognises each one and dresses it up with artwork and details." },
    { title: "Press play", body: "Open Strata on iPhone, iPad, Mac or Apple TV, and pick up where you left off on any of them." },
  ];
  return (
    <Section eyebrow="How it works" title="From your files to the sofa in minutes">
      <ol className="relative grid gap-10 md:grid-cols-3 md:gap-6">
        <div aria-hidden="true" className="absolute top-6 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-transparent via-[var(--primary)] to-transparent opacity-50 md:block" />
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex flex-col items-start gap-4 md:items-center md:text-center">
            <span className="bg-background text-brand-text border-primary/40 relative flex size-12 items-center justify-center rounded-full border text-lg font-semibold shadow-[0_0_30px_-6px_var(--primary)]">{i + 1}</span>
            <h3 className="text-xl font-semibold">{s.title}</h3>
            <p className="text-muted-foreground max-w-xs text-sm leading-relaxed">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** One feature card: an icon, a title, a line, and something to look at. */
function Bento({ icon: Icon, title, body, children, className }: { icon: typeof Zap; title: string; body: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card group relative flex flex-col overflow-hidden rounded-3xl border p-6 transition-colors hover:border-[var(--primary)]/40 sm:p-7", className)}>
      <div className="relative z-10 flex flex-col gap-2">
        <Icon className="text-brand-text size-5" />
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">{body}</p>
      </div>
      {children && <div className="relative mt-6 flex flex-1 items-end">{children}</div>}
    </div>
  );
}

function Features() {
  return (
    <div className="bg-muted/30 border-y">
      <Section eyebrow="Features" title="The experience your media deserves" lede="Everything you love about the big streaming apps, for the movies and shows that are already yours.">
        <div className="grid gap-4 md:grid-cols-6">
          <Bento icon={UserPlus} title="A profile for everyone" body="Everyone you invite gets their own picture, progress, Continue Watching and My List." className="md:col-span-4">
            <div className="flex flex-wrap gap-4">
              {AVATARS.map((a, i) => (
                <div key={a} className="flex flex-col items-center gap-2">
                  <img src={`/api/avatars/${a}.png`} alt="" className={cn("size-14 rounded-2xl transition-transform duration-300 group-hover:-translate-y-1 sm:size-16", i === 0 && "ring-2 ring-[var(--primary)]")} style={{ transitionDelay: `${i * 40}ms` }} />
                  <span className="text-muted-foreground text-xs">{["Maya", "Sam", "Leo", "Ava", "Kai", "Nora"][i]}</span>
                </div>
              ))}
            </div>
          </Bento>
          <Bento icon={Baby} title="Kids profiles" body="Set an age limit per profile. Anything above it doesn't show up." className="md:col-span-2">
            <div className="flex flex-wrap gap-2">
              {["All ages", "7+", "13+", "16+"].map((r, i) => (
                <span key={r} className={cn("rounded-full border px-3 py-1 text-xs", i === 1 ? "border-[var(--primary)] bg-[var(--primary)]/12 text-brand-text font-medium" : "text-muted-foreground")}>
                  {r}
                </span>
              ))}
            </div>
          </Bento>
          <Bento icon={Tv} title="Made for the big screen" body="Apple TV matches each video's frame rate and dynamic range, and you sign in by scanning a code with your phone." className="md:col-span-2">
            <div className="flex flex-wrap gap-2">
              {["4K", "HDR", "Dolby Vision", "Dolby Atmos"].map((b) => (
                <span key={b} className="rounded-md border px-2 py-1 font-mono text-[11px] font-semibold tracking-wide">
                  {b}
                </span>
              ))}
            </div>
          </Bento>
          <Bento icon={Zap} title="Plays everything, smoothly" body="Your files play straight to the device you're watching on, with Picture in Picture, AirPlay and subtitles." className="md:col-span-2">
            <div className="flex w-full items-center gap-2 text-xs">
              <span className="bg-muted rounded-md px-2 py-1">Your media</span>
              <span className="h-px flex-1 bg-gradient-to-r from-[var(--primary)] to-[var(--sand)]" />
              <span className="bg-primary text-primary-foreground rounded-md px-2 py-1 font-medium">Your TV</span>
            </div>
          </Bento>
          <Bento icon={Download} title="Downloads" body="Save movies and episodes on iPhone and iPad for the plane." className="md:col-span-2">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 36 36" className="size-12 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" className="stroke-muted" strokeWidth="3.5" />
                <circle cx="18" cy="18" r="15" fill="none" stroke="var(--primary)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="94.2" strokeDashoffset="28" />
              </svg>
              <div className="text-xs">
                <p className="font-medium">Downloading</p>
                <p className="text-muted-foreground">2 episodes left</p>
              </div>
            </div>
          </Bento>
          <Bento icon={Lock} title="Private by design" body="No ads, no analytics, no tracking, and nothing is sold. People join your household only by a link you send." className="md:col-span-6">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {["No ads", "No tracking", "Encrypted keys", "Invite-only households", "Delete everything any time"].map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <Check className="text-brand-text size-4" /> {t}
                </span>
              ))}
            </div>
          </Bento>
        </div>
      </Section>
    </div>
  );
}

type Cell = boolean | string;

/** Strata Cloud next to running your own server: the same apps, different trade-offs. */
const COMPARISON: { label: string; cloud: Cell; home: Cell }[] = [
  { label: "Set up", cloud: "Sign up in a minute", home: "Install on a Mac or Linux server" },
  { label: "The Strata apps", cloud: true, home: true },
  { label: "Profiles, kids limits and invitations", cloud: true, home: true },
  { label: "Media you keep online", cloud: true, home: true },
  { label: "Folders on your own disk", cloud: false, home: true },
  { label: "Devices at home join without a password", cloud: false, home: true },
  { label: "Works away from home", cloud: true, home: "With your own address or tunnel" },
  { label: "Updates", cloud: "Always up to date", home: "Updates itself" },
  { label: "Where your data lives", cloud: "Hosted for you", home: "On your machine" },
  { label: "Cost", cloud: "Free", home: "Free and open source" },
];

function Mark({ value }: { value: Cell }) {
  if (typeof value === "string") return <span className="text-sm">{value}</span>;
  return value ? <Check className="text-brand-text size-5" aria-label="Yes" /> : <Minus className="text-muted-foreground/50 size-5" aria-label="No" />;
}

function Compare() {
  return (
    <Section id="compare" eyebrow="Cloud or at home" title="Two ways to run Strata" lede="The same apps either way. Start in the cloud in a minute, or run your own server next to the files on your disk.">
      <div className="overflow-x-auto rounded-3xl border">
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <thead>
            <tr>
              <th className="w-2/5 p-4 sm:p-6" />
              <th className="bg-primary/8 border-primary/30 border-x border-t p-4 align-bottom sm:p-6">
                <span className="text-brand-text flex items-center gap-2 text-sm font-semibold">
                  <Cloud className="size-4" /> Strata Cloud
                </span>
                <span className="text-muted-foreground mt-1 block text-xs font-normal">We run it for you</span>
              </th>
              <th className="p-4 align-bottom sm:p-6">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Server className="size-4" /> Self-hosted
                </span>
                <span className="text-muted-foreground mt-1 block text-xs font-normal">You run it at home</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.label} className="border-t">
                <th scope="row" className="text-muted-foreground p-4 text-sm font-normal sm:px-6">
                  {row.label}
                </th>
                <td className="bg-primary/8 border-primary/30 border-x p-4 sm:px-6">
                  <Mark value={row.cloud} />
                </td>
                <td className="p-4 sm:px-6">
                  <Mark value={row.home} />
                </td>
              </tr>
            ))}
            <tr className="border-t">
              <td className="p-4 sm:p-6" />
              <td className="bg-primary/8 border-primary/30 border-x border-b p-4 sm:p-6">
                <Button asChild>
                  <a href={`${APP_URL}/signup`}>
                    Get started <ArrowRight />
                  </a>
                </Button>
              </td>
              <td className="p-4 sm:p-6">
                <Button variant="outline" asChild>
                  <a href={SOURCE_URL}>
                    See the source <ArrowRight />
                  </a>
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
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
          <p className="max-w-lg text-white/65">Bring your media, invite the people you watch with, and press play.</p>
          <Button size="lg" asChild className="h-12 px-6 text-base shadow-[0_0_40px_-8px_var(--primary)]">
            <a href={`${APP_URL}/signup`}>
              Create your household <ArrowRight />
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
          <a href={APP_URL} className="hover:text-foreground">
            Sign in
          </a>
          <a href={`${APP_URL}/signup`} className="hover:text-foreground">
            Get started
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
