import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleCheck, CircleDashed, X } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import { Link } from "@/lib/router";
import type { AdminStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const DISMISS_KEY = "strata.checklistDismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

interface Item {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  optional?: boolean;
  href: string;
  cta: string;
}

/** "Finish setting up" on the Overview while the basics aren't in place. */
export function SetupChecklist({ status }: { status: AdminStatus }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const profiles = useQuery({ queryKey: queryKeys.profiles, queryFn: api.profiles, enabled: !dismissed });
  const devices = useQuery({ queryKey: queryKeys.devices, queryFn: api.devices, enabled: !dismissed });

  if (dismissed || !profiles.data || !devices.data) return null;

  const items: Item[] = [
    { key: "tmdb", label: "Add a TMDB key", hint: "Powers the catalog, artwork and file matching.", done: status.tmdb.configured, href: "/settings#keys", cta: "Add key" },
    { key: "torbox", label: "Connect TorBox", hint: "Play titles straight from your TorBox library.", done: status.torbox.configured, optional: true, href: "/settings#keys", cta: "Connect" },
    { key: "profiles", label: "Create a profile", hint: "Each person gets their own progress and My List.", done: profiles.data.length > 0, href: "/profiles", cta: "Add profile" },
    {
      key: "device",
      label: "Connect a device",
      hint: "Open Strata on an iPhone, iPad, Mac or Apple TV and pick this server.",
      done: devices.data.items.some((d) => !d.isCurrent),
      href: "/devices",
      cta: "View devices",
    },
  ];

  const remaining = items.filter((i) => !i.done);
  if (remaining.length === 0) return null;
  const doneCount = items.length - remaining.length;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* hides for this visit only */
    }
    setDismissed(true);
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle>Finish setting up</CardTitle>
        <CardDescription>
          {doneCount} of {items.length} done
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label="Hide checklist">
            <X />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress value={(doneCount / items.length) * 100} aria-label="Setup progress" />
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.key} className={cn("flex items-start gap-3 rounded-lg border p-3", i.done && "opacity-60")}>
              {i.done ? <CircleCheck className="text-ok mt-0.5 size-5 shrink-0" /> : <CircleDashed className="text-muted-foreground mt-0.5 size-5 shrink-0" />}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {i.label}
                  {i.optional && !i.done && <Badge variant="secondary">Optional</Badge>}
                </p>
                <p className="text-muted-foreground text-xs">{i.hint}</p>
              </div>
              {!i.done && (
                <Button variant="ghost" size="sm" asChild className="shrink-0">
                  <Link href={i.href}>
                    {i.cta} <ArrowRight />
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
