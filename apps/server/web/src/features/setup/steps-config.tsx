import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, LoaderCircle, TriangleAlert } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys } from "@/lib/query";
import type { ServerInfo, Settings, SettingsResponse } from "@/lib/types";
import { ErrorAlert, InlineError } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldLabel, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/features/settings/fields";
import { MediaFolders } from "@/features/settings/media-folders";
import { KeyGuideButton } from "@/features/settings/key-guides";
import { SecretKeyForm } from "@/features/settings/secret-key-form";
import type { StepProps } from "./setup-wizard";
import { StepCard } from "./step-card";

function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.settings });
}

function LoadingBody() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-10" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-10" />
    </div>
  );
}

export function ServicesStep({ onNext, onBack }: StepProps) {
  const settings = useSettings();
  const secrets = settings.data?.secrets;
  return (
    <StepCard
      title="Connect your services"
      description="Each key is checked with its provider, then stored encrypted on this server. You can change them later in Settings."
      onBack={onBack}
      actions={
        <Button size="lg" onClick={onNext} variant={secrets?.tmdbApiKey ? "default" : "outline"}>
          {secrets?.tmdbApiKey ? "Continue" : "Do it later"} <ArrowRight />
        </Button>
      }
    >
      {settings.isPending ? (
        <LoadingBody />
      ) : !secrets ? (
        <ErrorAlert error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <>
          <SecretKeyForm
            secretKey="tmdbApiKey"
            label="TMDB"
            required
            configured={secrets.tmdbApiKey}
            guide={<KeyGuideButton secretKey="tmdbApiKey" />}
            description={
              <>
                Required to browse: titles, artwork and matching your files. Paste the v3 API key or the v4 read access token from{" "}
                <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
                  themoviedb.org/settings/api
                </a>{" "}
                (a free account works).
              </>
            }
          />
          <Separator />
          <SecretKeyForm
            secretKey="torboxApiKey"
            label="TorBox"
            configured={secrets.torboxApiKey}
            guide={<KeyGuideButton secretKey="torboxApiKey" />}
            description={
              <>
                Optional. Plays files straight from your TorBox library, and finds releases of titles you don't have. Find the key at{" "}
                <a href="https://torbox.app/settings" target="_blank" rel="noreferrer">
                  torbox.app/settings
                </a>
                .
              </>
            }
          />
          {!secrets.tmdbApiKey && (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>The catalog needs a TMDB key</AlertTitle>
              <AlertDescription>You can continue without one and add it later in Settings, but browsing and matching won't work until you do.</AlertDescription>
            </Alert>
          )}
        </>
      )}
    </StepCard>
  );
}

export function BasicsStep({ info, onNext, onBack }: StepProps) {
  const settings = useSettings();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const local = info.mode !== "cloud";

  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data.settings);
  }, [settings.data, draft]);

  const nameError = touched && draft && !draft.serverName.trim() ? "Give the server a name." : null;

  const save = async () => {
    setTouched(true);
    if (!draft || !settings.data || !draft.serverName.trim()) return;
    const before = settings.data.settings;
    const patch: Partial<Settings> = {};
    if (draft.serverName.trim() !== before.serverName) patch.serverName = draft.serverName.trim();
    if (draft.language !== before.language) patch.language = draft.language;
    if (local && JSON.stringify(draft.mediaFolders) !== JSON.stringify(before.mediaFolders)) patch.mediaFolders = draft.mediaFolders;
    if (local && draft.localJoin !== before.localJoin) patch.localJoin = draft.localJoin;
    if (Object.keys(patch).length === 0) return onNext();
    setSaving(true);
    setError(null);
    try {
      const r = await api.updateSettings(patch);
      queryClient.setQueryData<SettingsResponse>(queryKeys.settings, (d) => (d ? { ...d, settings: r.settings } : d));
      if (patch.serverName) queryClient.setQueryData<ServerInfo>(queryKeys.info, (i) => (i ? { ...i, serverName: r.settings.serverName } : i));
      onNext();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepCard
      title="Server basics"
      description="How this server shows up in the apps, and where your media lives."
      onBack={onBack}
      actions={
        <Button size="lg" onClick={() => void save()} disabled={saving || !draft}>
          {saving && <LoaderCircle className="animate-spin" />}
          {saving ? "Saving…" : "Save & continue"}
        </Button>
      }
    >
      {!draft ? (
        settings.error ? <ErrorAlert error={settings.error} onRetry={() => void settings.refetch()} /> : <LoadingBody />
      ) : (
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Server name" description="Shown in the apps when they find this server." error={nameError}>
              {(p) => <Input {...p} value={draft.serverName} maxLength={64} onChange={(e) => setDraft({ ...draft, serverName: e.target.value })} />}
            </FormField>
            <FormField label="Metadata language" description="TMDB language tag, e.g. en-US, fr-FR, ja-JP.">
              {(p) => <Input {...p} className="font-mono" value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} spellCheck={false} autoCapitalize="off" />}
            </FormField>
          </div>
          {local && (
            <>
              <Separator />
              <div className="flex flex-col gap-3">
                <div className="space-y-1">
                  <FieldLabel>Media folders</FieldLabel>
                  <p className="text-muted-foreground text-sm">
                    Folders on <em>this server</em> that hold movies or shows. Strata scans them and matches each file to TMDB. Network shares mounted on the server work too. Skip this if you only use TorBox.
                  </p>
                </div>
                <MediaFolders value={draft.mediaFolders} onChange={(v) => setDraft({ ...draft, mediaFolders: v })} />
              </div>
              <Separator />
              <SwitchField
                checked={draft.localJoin}
                onChange={(v) => setDraft({ ...draft, localJoin: v })}
                label="Let devices on my home network join without a password"
                description="They pick who they are from the first household's members, without a password, and can watch but not change settings. Away from home, devices sign in with your account. Turn this off if the server is exposed through a tunnel or port forward."
              />
            </>
          )}
          <InlineError error={error} />
        </FieldGroup>
      )}
    </StepCard>
  );
}
