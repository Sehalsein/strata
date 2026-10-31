import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { SecretKey } from "@/lib/types";
import { cn } from "@/lib/utils";

/** How to get each provider's key, step by step, with where to start. */
const GUIDES: Record<SecretKey, { start: { href: string; label: string }; steps: ReactNode[]; note?: ReactNode }> = {
  tmdbApiKey: {
    start: { href: "https://www.themoviedb.org/settings/api", label: "Open TMDB's API settings" },
    steps: [
      <>
        Sign in to <Ext href="https://www.themoviedb.org">themoviedb.org</Ext>, or make a free account (confirm your email first).
      </>,
      <>
        Open your profile menu › <b>Settings</b> › <b>API</b>.
      </>,
      <>
        Under <b>Request an API Key</b>, choose <b>Developer</b>, accept the terms, and fill in the short form: <i>Personal</i> use, any name and description (e.g. “Strata at home”), and your own
        website or <code>http://localhost</code> for the URL.
      </>,
      <>
        Copy the <b>API Read Access Token</b> (the long one) or the shorter <b>API Key</b>. Either works.
      </>,
    ],
    note: "Free for personal use.",
  },
  torboxApiKey: {
    start: { href: "https://torbox.app/settings", label: "Open TorBox settings" },
    steps: [
      <>
        Sign in at <Ext href="https://torbox.app">torbox.app</Ext>.
      </>,
      <>
        Open <b>Settings</b> and find <b>API Key</b>.
      </>,
      <>Copy the key (make one first if it's empty).</>,
    ],
    note: "Use your own account's key: anyone with it can use your TorBox. Making a new key there stops the old one working.",
  },
  omdbApiKey: {
    start: { href: "https://www.omdbapi.com/apikey.aspx", label: "Get an OMDb key" },
    steps: [
      <>
        On OMDb's key page, choose <b>FREE</b> (1,000 requests a day), and enter your email, name and a few words on what it's for.
      </>,
      <>
        OMDb emails the key with an activation link. <b>Click the link</b>: the key doesn't work until you do.
      </>,
      <>Copy the key from the email.</>,
    ],
    note: "Strata keeps the ratings it fetches, so the free 1,000 a day goes a long way.",
  },
};

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
      {children}
    </a>
  );
}

/** Numbered steps for getting a provider's key, with a button to where it starts. */
export function KeyGuide({ secretKey, className }: { secretKey: SecretKey; className?: string }) {
  const guide = GUIDES[secretKey];
  return (
    <div className={cn("flex flex-col gap-3 text-sm", className)}>
      <ol className="text-muted-foreground flex flex-col gap-2">
        {guide.steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="bg-muted text-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium">{i + 1}</span>
            <span className="[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:text-xs">{step}</span>
          </li>
        ))}
        <li className="flex gap-3">
          <span className="bg-muted text-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium">{guide.steps.length + 1}</span>
          <span>Paste it below. Strata checks it with the service before saving it.</span>
        </li>
      </ol>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <a href={guide.start.href} target="_blank" rel="noreferrer" className="text-foreground inline-flex items-center gap-1.5 font-medium underline underline-offset-4">
          {guide.start.label} <ExternalLink className="size-3.5" />
        </a>
        {guide.note && <span className="text-muted-foreground text-xs">{guide.note}</span>}
      </div>
    </div>
  );
}

/** The same steps, folded behind "How do I get one?" (the setup wizard). */
export function KeyGuideDisclosure({ secretKey }: { secretKey: SecretKey }) {
  return (
    <details className="group rounded-md border px-3 py-2">
      <summary className="text-foreground cursor-pointer text-sm font-medium select-none">How do I get one?</summary>
      <KeyGuide secretKey={secretKey} className="pt-3 pb-1" />
    </details>
  );
}
