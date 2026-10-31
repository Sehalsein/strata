import type { ReactNode } from "react";
import { Baby, Check, Download, Folder, FolderPlus, Lock, MonitorSmartphone, Pause, Smartphone, Sparkles, Tv, UserPlus, Zap } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Poster } from "@/components/poster-wall";
import { cn } from "@/lib/utils";
import { Reveal } from "./sections";

/** Some of the server's own profile pictures (this site passes /api through to it). */
const AVATARS = [
  { id: "fox", name: "Maya" },
  { id: "panda", name: "Sam" },
  { id: "robot", name: "Leo" },
  { id: "owl", name: "Ava" },
  { id: "dino", name: "Kai" },
];

function Heading({ eyebrow, title, lede, center }: { eyebrow: string; title: string; lede?: string; center?: boolean }) {
  return (
    <Reveal className={cn("mb-14 max-w-2xl", center && "mx-auto text-center")}>
      <p className="text-brand-text mb-3 text-xs font-semibold tracking-[0.14em] uppercase">{eyebrow}</p>
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h2>
      {lede && <p className="text-muted-foreground mt-4 text-lg text-pretty">{lede}</p>}
    </Reveal>
  );
}

/* ---------- How it works ---------- */

/** A step's picture: a little window with the part of Strata that step is about. */
function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl border bg-[#0b0c0f] p-5 text-[#f5f3ef]", className)}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_70%_at_50%_0%,rgba(243,146,86,0.18),transparent)]" />
      <div className="relative w-full">{children}</div>
    </div>
  );
}

/** Step 1: the menu bar app, open. */
function MenuBarStage() {
  return (
    <Stage>
      <div className="mx-auto flex max-w-[15rem] flex-col">
        <div className="flex items-center justify-end gap-2.5 rounded-t-lg bg-white/[0.07] px-3 py-1.5 text-[10px] text-white/60">
          <span>Wi‑Fi</span>
          <span className="flex items-center rounded bg-white/15 px-1 py-0.5">
            <BrandMark size={11} />
          </span>
          <span>9:41</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-b-lg border border-t-0 border-white/10 bg-[#1a1c20]/95 p-1.5 text-[11px] shadow-2xl">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="size-2 rounded-full bg-[#4cd08a] shadow-[0_0_8px_#4cd08a]" />
            <span className="font-medium">Strata is running</span>
          </div>
          <div className="mx-2 my-0.5 h-px bg-white/10" />
          <div className="rounded-md bg-[#f39256] px-2 py-1.5 font-medium text-[#1a0e06]">Open Dashboard</div>
          <div className="px-2 py-1.5 text-white/70">Check for Updates…</div>
          <div className="px-2 py-1.5 text-white/70">Start at Login ✓</div>
        </div>
      </div>
    </Stage>
  );
}

/** Step 2: folders added, files being matched. */
function FoldersStage() {
  const folders = [
    { name: "Movies", count: "214 titles", done: 100 },
    { name: "Shows", count: "38 shows", done: 100 },
    { name: "Home videos", count: "Matching…", done: 64 },
  ];
  return (
    <Stage>
      <div className="mx-auto flex max-w-[16rem] flex-col gap-2">
        {folders.map((f) => (
          <div key={f.name} className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2">
            <div className="flex items-center gap-2 text-[11px]">
              <Folder className="size-3.5 fill-[#f2b544]/30 text-[#f2b544]" />
              <span className="font-medium">{f.name}</span>
              <span className="ml-auto text-white/50">{f.count}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className={cn("h-full rounded-full", f.done === 100 ? "bg-[#4cd08a]" : "bg-[#f39256]")} style={{ width: `${f.done}%` }} />
            </div>
          </div>
        ))}
        <div className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 py-2 text-[11px] text-white/60">
          <FolderPlus className="size-3.5" /> Add folder
        </div>
      </div>
    </Stage>
  );
}

/** Step 3: playing, on the sofa. */
function PlayerStage() {
  return (
    <Stage className="p-0">
      <div className="relative aspect-[4/3] w-full">
        <div className="absolute inset-0" style={{ background: "linear-gradient(150deg, #22304f, #f08a48)" }} />
        <div className="absolute top-[18%] left-1/2 size-[34%] -translate-x-1/2 rounded-full bg-white/25 blur-[2px]" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 to-transparent" />
        <div className="absolute inset-x-5 bottom-5 flex flex-col gap-2.5">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] text-white/60">Season 1 · Episode 4</p>
              <p className="text-sm font-semibold">Northern Lines</p>
            </div>
            <span className="flex size-9 items-center justify-center rounded-full bg-white text-black">
              <Pause className="size-4 fill-current" />
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-white/60">
            <span>24:16</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
              <div className="h-full w-[46%] rounded-full bg-white" />
            </div>
            <span>52:30</span>
          </div>
        </div>
      </div>
    </Stage>
  );
}

export function Steps() {
  const steps = [
    { stage: <MenuBarStage />, title: "Install Strata", body: "Put the server on a Mac or Linux machine at home. On a Mac it lives in the menu bar, starts at login and keeps itself up to date." },
    { stage: <FoldersStage />, title: "Add your media", body: "Point it at the folders where your movies and shows live. Strata recognises each one and dresses it up with artwork and details." },
    { stage: <PlayerStage />, title: "Press play", body: "Open Strata on iPhone, iPad, Mac or Apple TV and pick up where you left off, on any of them." },
  ];
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
      <Heading eyebrow="How it works" title="From your files to the sofa in three steps" />
      <ol className="grid gap-10 md:grid-cols-3 md:gap-6">
        {steps.map((s, i) => (
          <Reveal key={s.title} delay={i * 120}>
            <li className="flex flex-col gap-5">
              {s.stage}
              <div className="flex gap-4">
                <span className="text-brand-text border-primary/40 flex size-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold shadow-[0_0_24px_-6px_var(--primary)]">{i + 1}</span>
                <div className="space-y-1.5">
                  <h3 className="text-lg font-semibold">{s.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{s.body}</p>
                </div>
              </div>
            </li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

/* ---------- Features ---------- */

/** A feature card: a picture on top (dark, like the apps), then what it is. */
function Card({ icon: Icon, title, body, children, className, visual }: { icon: typeof Zap; title: string; body: string; children: ReactNode; className?: string; visual?: string }) {
  return (
    <div className={cn("group bg-card relative flex flex-col overflow-hidden rounded-3xl border transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--primary)]/40 hover:shadow-[0_20px_60px_-30px_var(--primary)]", className)}>
      <div className={cn("relative flex min-h-48 flex-1 items-center justify-center overflow-hidden bg-[#0b0c0f] p-6 text-[#f5f3ef]", visual)}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,rgba(243,146,86,0.16),transparent)] opacity-70 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="relative w-full">{children}</div>
      </div>
      <div className="flex flex-col gap-1.5 border-t p-6">
        <h3 className="flex items-center gap-2 font-semibold">
          <Icon className="text-brand-text size-4" /> {title}
        </h3>
        <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

/** "Who's watching?", like the apps' profile picker. */
function ProfilesVisual() {
  return (
    <div className="flex flex-col items-center gap-5">
      <p className="text-sm font-medium text-white/80">Who's watching?</p>
      <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
        {AVATARS.map((a, i) => (
          <div key={a.id} className="flex flex-col items-center gap-2" style={{ transitionDelay: `${i * 40}ms` }}>
            <img
              src={`/api/avatars/${a.id}.png`}
              alt=""
              className={cn("size-14 rounded-2xl transition-transform duration-300 group-hover:-translate-y-1 sm:size-[4.5rem]", i === 0 && "ring-2 ring-white ring-offset-2 ring-offset-[#0b0c0f]")}
              style={{ transitionDelay: `${i * 50}ms` }}
            />
            <span className={cn("text-xs", i === 0 ? "text-white" : "text-white/50")}>{a.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Posters above the age limit, hidden. */
function KidsVisual() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-white/70">
          <img src="/api/avatars/dino.png" alt="" className="size-5 rounded-md" /> Kai
        </span>
        <span className="rounded-full bg-[#f39256]/20 px-2 py-0.5 font-medium text-[#f6a574]">Up to 7+</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[6, 12, 19].map((seed, i) => (
          <div key={seed} className="relative">
            <Poster seed={seed} />
            {i === 2 && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#0b0c0f]/80 backdrop-blur-sm">
                <Lock className="size-5 text-white/70" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A TV, with what it switches to. */
function BigScreenVisual() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-full rounded-lg border border-white/10 bg-black p-1">
        <div className="relative aspect-video overflow-hidden rounded-md" style={{ background: "linear-gradient(140deg, #13242b, #f7c873)" }}>
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute right-2 bottom-2 left-2 flex flex-wrap gap-1">
            {["4K", "HDR", "DOLBY VISION", "ATMOS"].map((b) => (
              <span key={b} className="rounded border border-white/40 px-1 py-px font-mono text-[8px] font-semibold tracking-wide">
                {b}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="h-1 w-1/4 rounded-full bg-white/15" />
    </div>
  );
}

/** Files to the screen, nothing in between. */
function DirectVisual() {
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <span className="flex flex-col items-center gap-1.5">
        <span className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06]">
          <Folder className="size-5 text-[#f2b544]" />
        </span>
        Your files
      </span>
      <span className="relative h-px flex-1 overflow-hidden bg-white/15">
        <span className="animate-flow absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[#f39256] to-transparent" />
      </span>
      <span className="flex flex-col items-center gap-1.5">
        <span className="flex size-11 items-center justify-center rounded-xl bg-[#f39256] text-[#1a0e06]">
          <Tv className="size-5" />
        </span>
        Your TV
      </span>
    </div>
  );
}

/** Resume on the next screen. */
function EverywhereVisual() {
  const rows = [
    { icon: Tv, label: "Living room", at: 72 },
    { icon: Smartphone, label: "Maya's iPhone", at: 72 },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <div key={r.label} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-[11px]">
          <r.icon className="size-4 text-white/70" />
          <div className="flex-1 space-y-1.5">
            <div className="flex justify-between">
              <span>{r.label}</span>
              <span className="text-white/50">{i === 0 ? "Paused" : "Resume at 38:10"}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-[#f39256]" style={{ width: `${r.at}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A download, most of the way there. */
function DownloadsVisual() {
  return (
    <div className="flex items-center gap-4">
      <div className="w-16 shrink-0">
        <Poster seed={9} />
      </div>
      <div className="flex-1 space-y-2 text-[11px]">
        <p className="font-medium">Paper Moons</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
          <div className="h-full w-[78%] rounded-full bg-[#4cd08a]" />
        </div>
        <p className="flex items-center gap-1 text-white/50">
          <Download className="size-3" /> 1.2 of 1.6 GB · for the flight
        </p>
      </div>
    </div>
  );
}

/** What stays where. */
function PrivateVisual() {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {["Runs on your machine", "No ads", "No tracking", "Invite-only", "Open source"].map((t) => (
        <span key={t} className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs">
          <Check className="size-3.5 text-[#f6a574]" /> {t}
        </span>
      ))}
    </div>
  );
}

export function Features() {
  return (
    <div className="bg-muted/30 border-y">
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <Heading eyebrow="Features" title="The experience your media deserves" lede="Everything you love about the big streaming apps, for the movies and shows that are already yours." />
        <Reveal className="grid gap-4 md:grid-cols-6">
          <Card icon={UserPlus} title="A profile for everyone" body="Everyone you invite gets their own picture, progress, Continue Watching and My List." className="md:col-span-4">
            <ProfilesVisual />
          </Card>
          <Card icon={Baby} title="Kids profiles" body="Set an age limit per profile; anything above it doesn't show up." className="md:col-span-2">
            <KidsVisual />
          </Card>
          <Card icon={Tv} title="Made for the big screen" body="Apple TV matches each video's frame rate and dynamic range, and you sign in by scanning a code." className="md:col-span-2">
            <BigScreenVisual />
          </Card>
          <Card icon={MonitorSmartphone} title="Pick up anywhere" body="Pause on the TV, carry on in bed. Your place follows you to every screen." className="md:col-span-2">
            <EverywhereVisual />
          </Card>
          <Card icon={Zap} title="Plays everything, smoothly" body="Files play straight to the screen you're watching, with Picture in Picture, AirPlay and subtitles." className="md:col-span-2">
            <DirectVisual />
          </Card>
          <Card icon={Download} title="Downloads" body="Save movies and episodes on iPhone and iPad and watch them offline." className="md:col-span-3">
            <DownloadsVisual />
          </Card>
          <Card icon={Sparkles} title="Yours, at home" body="Your library and everything about it stay on your machine. People join only by a link you send." className="md:col-span-3">
            <PrivateVisual />
          </Card>
        </Reveal>
      </section>
    </div>
  );
}
