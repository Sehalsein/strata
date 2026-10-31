import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Lock, Pencil, Plus, Trash, Users } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys, useApiMutation } from "@/lib/query";
import type { ContentLimit, Profile } from "@/lib/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, ErrorAlert, InlineError } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup, FieldLegend, FieldSet, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const PIN_RE = /^\d{4,8}$/;

export const LIMIT_LABELS: Record<ContentLimit, { short: string; long: string }> = {
  none: { short: "Everything", long: "No limit" },
  teen: { short: "Up to PG-13 / TV-14", long: "Teens: up to PG-13 and TV-14" },
  kids: { short: "Up to PG / TV-PG", long: "Kids: up to PG and TV-PG" },
  little: { short: "Up to G / TV-Y7", long: "Little kids: G, TV-Y, TV-Y7 and TV-G" },
};

const AVATAR_FILLS = ["var(--sand)", "var(--primary)", "var(--local)", "var(--torbox)"];

/** Same pick as the apps (FNV-1a over the profile id), so a profile has one color everywhere. */
function avatarFill(id: number): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(String(id))) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return AVATAR_FILLS[hash % AVATAR_FILLS.length]!;
}

export function ProfileAvatar({ profile }: { profile: Profile }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-base font-semibold text-black/80" aria-hidden="true" style={{ background: avatarFill(profile.id) }}>
      {profile.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** List, add, edit and delete viewing profiles. Used by the Profiles page and the setup wizard. */
export function ProfileManager() {
  const profiles = useQuery({ queryKey: queryKeys.profiles, queryFn: api.profiles });
  const [editing, setEditing] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const remove = useApiMutation((p: Profile) => api.deleteProfile(p.id), { success: (_, p) => `Deleted ${p.name}`, invalidate: [queryKeys.profiles] });

  const list = profiles.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      {profiles.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : profiles.error ? (
        <ErrorAlert error={profiles.error} title="Couldn't load profiles" onRetry={() => void profiles.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={Users} title="No profiles yet" description="Add one below. Devices pick a profile after they connect." />
      ) : (
        <TooltipProvider>
          <ul className="divide-y rounded-lg border">
            {list.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3">
                <ProfileAvatar profile={p} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                    {p.isKids && <Badge variant="success">Kids</Badge>}
                    {p.hasPin ? (
                      <Badge variant="accent">
                        <Lock /> PIN
                      </Badge>
                    ) : (
                      <span>No PIN</span>
                    )}
                    <span>· {LIMIT_LABELS[p.contentLimit].short}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                    <Pencil />
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* A disabled button swallows hover, so the tooltip hangs off a wrapper. */}
                      <span tabIndex={list.length <= 1 ? 0 : -1}>
                        <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => setDeleting(p)} disabled={list.length <= 1} aria-label={`Delete ${p.name}`}>
                          <Trash />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {list.length <= 1 && <TooltipContent>The last profile can't be deleted</TooltipContent>}
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        </TooltipProvider>
      )}

      <AddProfileForm />

      <EditProfileDialog profile={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete “${deleting.name}”?` : "Delete profile?"}
        description="Its watch progress and My List go with it. This can't be undone."
        confirmLabel="Delete profile"
        onConfirm={() => (deleting ? remove.mutateAsync(deleting) : undefined)}
      />
    </div>
  );
}

function AddProfileForm() {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [isKids, setIsKids] = useState(false);
  const [touched, setTouched] = useState(false);
  const create = useApiMutation(() => api.createProfile(name.trim(), pin || undefined, isKids), {
    success: () => `Added ${name.trim()}`,
    invalidate: [queryKeys.profiles],
    silentError: true,
    onSuccess: () => {
      setName("");
      setPin("");
      setIsKids(false);
      setTouched(false);
    },
  });

  const pinError = pin && !PIN_RE.test(pin) ? "PIN must be 4–8 digits." : null;
  const nameError = touched && !name.trim() ? "Give the profile a name." : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim() || pinError) return;
    create.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-lg border border-dashed p-4">
      <h3 className="text-sm font-medium">Add a profile</h3>
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-start">
        <FormField label="Name" error={nameError}>
          {(p) => <Input {...p} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
        </FormField>
        <FormField label="PIN (optional)" error={touched ? pinError : null}>
          {(p) => <Input {...p} className="font-mono" inputMode="numeric" maxLength={8} placeholder="4–8 digits" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoComplete="off" />}
        </FormField>
        <Button type="submit" className="sm:mt-[1.375rem]" disabled={create.isPending}>
          {create.isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}
          Add profile
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox id="new-profile-kids" checked={isKids} onCheckedChange={(v) => setIsKids(v === true)} />
        <Label htmlFor="new-profile-kids" className="leading-snug font-normal">
          Kids profile: only titles rated PG / TV-PG or below. You can change the limit later.
        </Label>
      </div>
      <InlineError error={create.error} />
    </form>
  );
}

function EditProfileDialog({ profile, onOpenChange }: { profile: Profile | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!profile} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{profile ? `Edit ${profile.name}` : "Edit profile"}</DialogTitle>
          <DialogDescription>Changes apply on every device the next time this profile is picked.</DialogDescription>
        </DialogHeader>
        {profile && <EditProfileForm key={profile.id} profile={profile} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditProfileForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [name, setName] = useState(profile.name);
  const [isKids, setIsKids] = useState(profile.isKids);
  const [limit, setLimit] = useState<ContentLimit>(profile.contentLimit);
  const [pinMode, setPinMode] = useState<"keep" | "set" | "remove">("keep");
  const [pin, setPin] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const nameError = touched && !name.trim() ? "Give the profile a name." : null;
  const pinError = touched && pinMode === "set" && !PIN_RE.test(pin) ? "PIN must be 4–8 digits." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim() || (pinMode === "set" && !PIN_RE.test(pin))) return;
    const patch: { name?: string; pin?: string | null; isKids?: boolean; contentLimit?: ContentLimit } = {};
    if (name.trim() !== profile.name) patch.name = name.trim();
    if (isKids !== profile.isKids) patch.isKids = isKids;
    if (limit !== profile.contentLimit) patch.contentLimit = limit;
    if (pinMode === "set") patch.pin = pin;
    if (pinMode === "remove") patch.pin = null;
    if (Object.keys(patch).length === 0) return onDone();
    setPending(true);
    setError(null);
    try {
      await api.updateProfile(profile.id, patch);
      toast.success(`Saved ${name.trim()}`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField label="Name" error={nameError}>
          {(p) => <Input {...p} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />}
        </FormField>
        <FormField
          label="Content limit"
          description="Titles rated above this are hidden everywhere on this profile and can't be played. Unrated titles show only if they're family or kids' animation. Put PINs on other profiles so this one can't just switch."
        >
          {(p) => (
            <Select value={limit} onValueChange={(v) => setLimit(v as ContentLimit)}>
              <SelectTrigger {...p} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(LIMIT_LABELS) as ContentLimit[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {LIMIT_LABELS[key].long}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <div className="flex items-center gap-2">
          <Checkbox
            id="edit-profile-kids"
            checked={isKids}
            onCheckedChange={(v) => {
              const on = v === true;
              setIsKids(on);
              if (on && limit === "none") setLimit("kids");
            }}
          />
          <Label htmlFor="edit-profile-kids" className="font-normal">
            Kids profile
          </Label>
        </div>
        <FieldSet>
          <FieldLegend>PIN</FieldLegend>
          <RadioGroup value={pinMode} onValueChange={(v) => setPinMode(v as typeof pinMode)} className="flex flex-wrap gap-4">
            {(
              [
                ["keep", profile.hasPin ? "Keep current PIN" : "No PIN"],
                ["set", profile.hasPin ? "Change PIN" : "Set a PIN"],
                ...(profile.hasPin ? [["remove", "Remove PIN"]] : []),
              ] as [string, string][]
            ).map(([value, label]) => (
              <div key={value} className="flex items-center gap-2">
                <RadioGroupItem value={value} id={`pin-${value}`} />
                <Label htmlFor={`pin-${value}`} className="font-normal">
                  {label}
                </Label>
              </div>
            ))}
          </RadioGroup>
          {pinMode === "set" && (
            <FormField label="New PIN" description="4–8 digits. Asked for when this profile is picked on a device." error={pinError}>
              {(p) => <Input {...p} className="font-mono" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoComplete="off" autoFocus />}
            </FormField>
          )}
        </FieldSet>
        <InlineError error={error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}
