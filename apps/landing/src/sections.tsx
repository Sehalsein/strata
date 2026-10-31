import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, FileVideo, Laptop, Smartphone, Tablet, Tv } from "lucide-react";
import { Poster } from "@/components/poster-wall";
import { cn } from "@/lib/utils";

/** Fades its children in the first time they scroll into view (at once with reduced motion). */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return setShown(true);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={cn("transition-all duration-700 ease-out", shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0", className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Made-up files (no real titles), and what Strata makes of them. */
const FILES = [
  { file: "the.lighthouse.keeper.2021.2160p.hdr.mkv", title: "The Lighthouse Keeper", meta: "2021 · Drama · 1h 54m", seed: 4 },
  { file: "Northern_Lines_S02E05_1080p.mp4", title: "Northern Lines", meta: "Season 2 · Episode 5", seed: 15 },
  { file: "paper.moons.(2018).mkv", title: "Paper Moons", meta: "2018 · Animation · 1h 32m", seed: 22 },
];

/** "Your media, beautifully", shown: file names on one side, the library Strata makes on the other. */
export function Transform() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
      <Reveal className="mb-12 max-w-2xl">
        <p className="text-brand-text mb-3 text-xs font-semibold tracking-[0.14em] uppercase">Your media, beautifully</p>
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">From file names to a library you'll want to browse</h2>
        <p className="text-muted-foreground mt-4 text-lg text-pretty">
          Strata recognises every movie and episode, then gives it artwork, a description, cast, seasons and your progress. Nothing to rename, nothing to tag.
        </p>
      </Reveal>
      <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto_1.2fr]">
        <Reveal className="bg-card rounded-3xl border p-5 font-mono text-[13px]">
          <p className="text-muted-foreground mb-3 font-sans text-xs font-medium">Before</p>
          <ul className="flex flex-col gap-2">
            {FILES.map((f) => (
              <li key={f.file} className="bg-muted/50 flex items-center gap-2.5 truncate rounded-lg px-3 py-2.5">
                <FileVideo className="text-muted-foreground size-4 shrink-0" />
                <span className="truncate">{f.file}</span>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={150} className="flex justify-center">
          <div className="bg-primary text-primary-foreground flex size-12 items-center justify-center rounded-full shadow-[0_0_40px_-6px_var(--primary)] lg:rotate-0">
            <ArrowRight className="size-5 rotate-90 lg:rotate-0" />
          </div>
        </Reveal>
        <Reveal delay={300} className="rounded-3xl bg-[#0b0c0f] p-5 text-[#f5f3ef] ring-1 ring-white/10">
          <p className="mb-3 text-xs font-medium text-white/50">After</p>
          <ul className="grid grid-cols-3 gap-3">
            {FILES.map((f) => (
              <li key={f.title} className="flex flex-col gap-2">
                <Poster seed={f.seed} />
                <div>
                  <p className="truncate text-sm font-medium">{f.title}</p>
                  <p className="truncate text-[11px] text-white/50">{f.meta}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/** Every screen the apps run on. */
export function Screens() {
  const screens = [
    { icon: Smartphone, name: "iPhone", line: "Downloads, PiP and AirPlay" },
    { icon: Tablet, name: "iPad", line: "A sidebar for your library" },
    { icon: Laptop, name: "Mac", line: "In a window or full screen" },
    { icon: Tv, name: "Apple TV", line: "4K, HDR and Dolby Vision" },
  ];
  return (
    <section className="border-y">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden px-0 md:grid-cols-4">
        {screens.map((s, i) => (
          <Reveal key={s.name} delay={i * 80} className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            <s.icon className="text-brand-text size-8" strokeWidth={1.5} />
            <p className="text-lg font-semibold">{s.name}</p>
            <p className="text-muted-foreground text-sm">{s.line}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const FAQ: { q: string; a: string }[] = [
  { q: "Does Strata come with movies or shows?", a: "No. Strata doesn't host, sell or provide any media. It's an app for the movies and shows you already have: it organises them, adds artwork and details, and plays them." },
  { q: "What does it cost?", a: "Strata Cloud is free to get started, and the self-hosted server is free and open source." },
  { q: "Which devices does it run on?", a: "iPhone, iPad, Mac and Apple TV, with the dashboard in any browser for running your household." },
  { q: "Who can see my household?", a: "Only the people you invite. Each gets their own profile, and you can set an age limit on kids' profiles." },
  { q: "Can I run it myself instead?", a: "Yes. Install the server on a Mac or Linux machine and point the same apps at it. It can also play folders of files on that machine's disk." },
  { q: "What happens to my data?", a: "No ads, no analytics and no tracking, and nothing is sold. The privacy page lists exactly what's kept, and you can have it all deleted." },
];

export function Faq() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
      <Reveal className="mb-10 text-center">
        <p className="text-brand-text mb-3 text-xs font-semibold tracking-[0.14em] uppercase">Questions</p>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">Good to know</h2>
      </Reveal>
      <div className="divide-y rounded-3xl border">
        {FAQ.map((item) => (
          <details key={item.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
              {item.q}
              <ChevronDown className="text-muted-foreground size-5 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
