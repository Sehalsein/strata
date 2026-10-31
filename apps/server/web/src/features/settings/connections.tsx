import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys } from "@/lib/query";
import type { SecretKey, SettingsResponse } from "@/lib/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Provider {
  key: SecretKey;
  name: string;
  /** Initials and colour for its mark. */
  mark: { text: string; className: string };
  what: string;
  keyHelp: ReactNode;
  getKeyUrl: string;
  required?: boolean;
  /** The server's (every household) or this household's. */
  scope: "server" | "household";
}

const PROVIDERS: Provider[] = [
  {
    key: "torboxApiKey",
    name: "TorBox",
    mark: { text: "TB", className: "bg-emerald-600 text-white" },
    what: "Plays your TorBox library straight from TorBox, and finds releases of titles you don't have. Saving a key starts a library sync.",
    keyHelp: "Your API key from TorBox's settings.",
    getKeyUrl: "https://torbox.app/settings",
    scope: "household",
  },
  {
    key: "tmdbApiKey",
    name: "TMDB",
    mark: { text: "TM", className: "bg-sky-600 text-white" },
    what: "The catalog: titles, artwork, cast, and matching your files to them.",
    keyHelp: "A v3 API key or v4 read access token (a free account works).",
    getKeyUrl: "https://www.themoviedb.org/settings/api",
    required: true,
    scope: "server",
  },
  {
    key: "omdbApiKey",
    name: "OMDb",
    mark: { text: "OM", className: "bg-amber-500 text-black" },
    what: "IMDb and Rotten Tomatoes ratings on title pages.",
    keyHelp: "A free key by email (1,000 requests a day; Strata caches answers).",
    getKeyUrl: "https://www.omdbapi.com/apikey.aspx",
    scope: "server",
  },
];

/**
 * The services Strata connects to, each with its status, what it's for and whose it is.
 * Keys are checked with the provider before they're saved, then stored encrypted on the
 * server and never shown again. The server's keys are its admin's to change.
 */
export function Connections({ secrets, isServerAdmin, householdName }: { secrets: SettingsResponse["secrets"]; isServerAdmin: boolean; householdName: string }) {
  const household = PROVIDERS.filter((p) => p.scope === "household");
  const server = PROVIDERS.filter((p) => p.scope === "server");
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <GroupHeading title={`For ${householdName}`} description="Only this household uses these." />
        {household.map((p) => (
          <ProviderCard key={p.key} provider={p} configured={!!secrets[p.key]} canEdit />
        ))}
      </section>
      <section className="flex flex-col gap-3">
        <GroupHeading title="For the whole server" description={isServerAdmin ? "Every household shares these." : "Every household shares these. The server's admin sets them."} />
        {server.map((p) => (
          <ProviderCard key={p.key} provider={p} configured={!!secrets[p.key]} canEdit={isServerAdmin} />
        ))}
      </section>
      <p className="text-muted-foreground text-xs">Keys are checked with each service before they're saved, then stored encrypted on this server. They're never shown again.</p>
    </div>
  );
}

function GroupHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

function ProviderCard({ provider: p, configured, canEdit }: { provider: Provider; configured: boolean; canEdit: boolean }) {
  const [entering, setEntering] = useState(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const setConfigured = (v: boolean) => {
    queryClient.setQueryData<SettingsResponse>(queryKeys.settings, (d) => (d ? { ...d, secrets: { ...d.secrets, [p.key]: v } } : d));
    void queryClient.invalidateQueries({ queryKey: queryKeys.status });
    if (p.key === "torboxApiKey") void queryClient.invalidateQueries({ queryKey: ["admin", "torbox-account"] });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return setError("Paste a key first.");
    setPending(true);
    setError(null);
    try {
      await api.setSecret(p.key, value.trim());
      setValue("");
      setEntering(false);
      setConfigured(true);
      toast.success(`${p.name} connected`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    try {
      await api.setSecret(p.key, null);
      setConfigured(false);
      toast.success(`${p.name} disconnected`);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const status = configured ? (
    <Badge variant="success">Connected</Badge>
  ) : p.required ? (
    <Badge variant="warning">Needed</Badge>
  ) : (
    <Badge variant="secondary">Not connected</Badge>
  );

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold", p.mark.className)} aria-hidden>
          {p.mark.text}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{p.name}</h3>
            {status}
          </div>
          <p className="text-muted-foreground text-sm">{p.what}</p>
          {configured && p.key === "torboxApiKey" && <TorboxAccountLine />}
        </div>
        {canEdit && !entering && (
          <div className="flex shrink-0 gap-2">
            {configured ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setEntering(true)}>
                  Replace key
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmRemove(true)}>
                  Disconnect
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setEntering(true)}>
                Connect
              </Button>
            )}
          </div>
        )}
      </div>

      {canEdit && entering && (
        <form onSubmit={save} noValidate className="bg-muted/30 flex flex-col gap-3 border-t p-5">
          <p className="text-muted-foreground text-sm">
            {p.keyHelp}{" "}
            <a href={p.getKeyUrl} target="_blank" rel="noreferrer" className="text-foreground inline-flex items-center gap-1 underline underline-offset-4">
              Get a key <ExternalLink className="size-3" />
            </a>
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label={`${p.name} API key`}
              className="font-mono"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              placeholder="Paste the key"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              aria-invalid={!!error}
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={pending} className="shrink-0">
                {pending && <LoaderCircle className="animate-spin" />}
                {pending ? "Checking…" : "Check & save"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEntering(false);
                  setValue("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </form>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Disconnect ${p.name}?`}
        description={p.scope === "server" ? "Every household stops using it until a new key is added." : "This household stops using it until a new key is added."}
        confirmLabel="Disconnect"
        onConfirm={remove}
      />
    </Card>
  );
}

/** The TorBox account a key belongs to: who, which plan, until when. */
function TorboxAccountLine() {
  const account = useQuery({ queryKey: ["admin", "torbox-account"], queryFn: api.torboxAccount, staleTime: 5 * 60_000, retry: false });
  if (account.isPending) return <Skeleton className="mt-2 h-4 w-56" />;
  if (!account.data) return <p className="text-warn pt-1 text-sm">TorBox didn't answer with this key. Replace it if it was revoked.</p>;
  const { email, plan, premiumExpiresAt } = account.data;
  const until = premiumExpiresAt ? new Date(premiumExpiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
  const planName = typeof plan === "number" ? (["Free", "Essential", "Pro", "Standard"][plan] ?? `Plan ${plan}`) : plan;
  return <p className="text-sm pt-1">{[email, planName && `${planName} plan`, until && `until ${until}`].filter(Boolean).join(" · ")}</p>;
}
