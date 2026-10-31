import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { Skeleton } from "@/components/ui/skeleton";

interface PrivacyInfo {
  serverName: string;
  contact: string | null;
  operator: string | null;
  mode: "home" | "cloud";
  email: boolean;
  google: boolean;
  passkeys: boolean;
}

/**
 * /privacy: what this server keeps about the people who use it, why, who else sees any of
 * it, for how long, and how to get a copy or have it deleted. Built from what this server
 * has switched on; who runs it and how to reach them come from STRATA_OPERATOR and
 * STRATA_PRIVACY_CONTACT.
 */
export default function PrivacyPage() {
  const info = useQuery({ queryKey: ["privacy"], queryFn: () => request<PrivacyInfo>("GET", "/privacy", undefined, { auth: false }) });
  const p = info.data;
  const operator = p?.operator ?? `whoever runs ${p?.serverName ?? "this server"}`;
  return (
    <div className="bg-background min-h-svh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5">
        <a href="/" className="flex items-center gap-2 font-semibold">
          <BrandMark size={24} /> {p?.serverName ?? "Strata"}
        </a>
        <ModeToggle />
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
        {!p ? (
          <div className="mt-6 flex flex-col gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : (
          <div className="text-muted-foreground mt-4 flex flex-col gap-8 text-[15px] leading-relaxed [&_b]:text-foreground [&_h2]:text-foreground [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
            <p>
              This page explains what {p.serverName} keeps about you, why, and what you can do about it. {p.serverName} runs Strata, and is run by <b>{operator}</b>, who is responsible for your
              data here.
              {p.contact && (
                <>
                  {" "}
                  Questions or requests: <Contact value={p.contact} />.
                </>
              )}
            </p>

            <Section title="What's kept">
              <ul>
                <li>
                  <b>Your account:</b> your name, which of the server's profile pictures you picked, your username, email address (if you gave one) and your password, stored only as a one-way hash.
                </li>
                <li>
                  <b>Your household:</b> which household you're in, your role, and, for kids profiles, the age limit.
                </li>
                <li>
                  <b>What you watch:</b> where you stopped in each title, what's finished, and My List, so you can pick up on any device.
                </li>
                <li>
                  <b>Your devices:</b> for each device signed in, its name and model, the app or browser, its IP address{p.mode === "cloud" ? ", the approximate city and country that address points to" : ""}, and when it was last active.
                  {p.mode === "home" && " On the home network the server may also see a device's network (MAC) address while it's connected; it isn't stored."}
                </li>
                {(p.google || p.passkeys) && (
                  <li>
                    <b>Other ways in:</b>
                    {p.google && " if you connect Google, your Google account's id"}
                    {p.google && p.passkeys && ";"}
                    {p.passkeys && " if you add a passkey, its public key and the name you gave it (the private key never leaves your device)"}.
                  </li>
                )}
                <li>
                  <b>Your household's service keys</b> (TMDB, TorBox, OMDb), encrypted, used only for your household.
                </li>
              </ul>
              <p className="mt-3">There are no ads, no analytics and no tracking, and nothing is sold. The only cookies are the ones that keep you signed in.</p>
            </Section>

            <Section title="Why">
              <p>
                To run the service you signed up for: your account, your household's library, playback and picking up where you left off. Device details are kept to show you where you're
                signed in and to protect your account (spotting sign-ins you don't recognise, limiting password guessing).
              </p>
            </Section>

            <Section title="Who else is involved">
              <ul>
                {p.mode === "cloud" && (
                  <li>
                    <b>Hosting:</b> the server and its database run with cloud providers (for example Cloudflare and Neon), who store the data above on {operator}'s behalf.
                  </li>
                )}
                {p.email && (
                  <li>
                    <b>Email:</b> password-reset emails are sent through Resend, which receives your email address and the message.
                  </li>
                )}
                {p.google && (
                  <li>
                    <b>Google:</b> only if you choose to sign in with Google.
                  </li>
                )}
                <li>
                  <b>TMDB and OMDb:</b> the server asks them for titles, artwork and ratings with your household's key. They aren't told who you are.
                </li>
                <li>
                  <b>TorBox:</b> if your household uses it, your device plays video straight from TorBox, so TorBox sees your device's IP address, as any website you visit does.
                </li>
              </ul>
            </Section>

            <Section title="How long">
              <ul>
                <li>A device's details last as long as it stays signed in: up to 90 days without use, or until you sign it out.</li>
                <li>Your account, household membership and watch history last until you delete your account.</li>
                <li>Password-reset links last an hour.</li>
              </ul>
            </Section>

            <Section title="Your rights">
              <p>You can, at any time:</p>
              <ul>
                <li>
                  <b>Get a copy</b> of everything above: ask your household's owner or an admin, who can download it for you{p.contact ? ", or write to the contact above" : ""}.
                </li>
                <li>
                  <b>Correct it:</b> your household's admin can rename you; ask them or the contact below for anything else.
                </li>
                <li>
                  <b>Delete it:</b> ask your household's owner or an admin{p.contact ? " (or the contact above)" : ""} to delete your account. That removes it and everything kept about you, and signs out every device at once.
                </li>
                <li>
                  <b>Sign out a device</b> you don't recognise: ask your household's admin, who sees every device in the household, or change your password, which signs out all the others.
                </li>
              </ul>
              <p className="mt-3">
                If you're in the EU, the UK or elsewhere with data protection law, you can also object to how your data is used and complain to your data protection authority.
                {p.contact && (
                  <>
                    {" "}
                    Write to <Contact value={p.contact} /> first and we'll help.
                  </>
                )}
              </p>
            </Section>

            <Section title="Children">
              <p>Kids profiles are set up and managed by an adult in the household. They keep only what's needed to play: the profile's name, age limit and what it has watched.</p>
            </Section>
          </div>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Contact({ value }: { value: string }) {
  const href = value.includes("@") && !value.includes("://") ? `mailto:${value}` : value;
  return (
    <a href={href} className="text-foreground underline underline-offset-4">
      {value}
    </a>
  );
}
