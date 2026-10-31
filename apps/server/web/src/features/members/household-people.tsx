import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, KeyRound, LoaderCircle, Mail, MoreHorizontal, Pencil, QrCode as QrCodeIcon, Trash, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/app/session";
import { api } from "@/lib/api";
import { authClient, invitationLink } from "@/lib/auth-client";
import { relativeTime } from "@/lib/format";
import { queryKeys, useApiMutation } from "@/lib/query";
import type { ContentLimit, HouseholdRole, Invitation, Member } from "@/lib/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SignInCodeDialog } from "./sign-in-code-dialog";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { EmptyState, ErrorAlert, InlineError } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

export const LIMIT_LABELS: Record<ContentLimit, { short: string; long: string }> = {
  none: { short: "Everything", long: "No limit" },
  teen: { short: "Up to PG-13 / TV-14", long: "Teens: up to PG-13 and TV-14" },
  kids: { short: "Up to PG / TV-PG", long: "Kids: up to PG and TV-PG" },
  little: { short: "Up to G / TV-Y7", long: "Little kids: G, TV-Y, TV-Y7 and TV-G" },
};

export const ROLE_LABELS: Record<HouseholdRole, { label: string; hint: string }> = {
  owner: { label: "Owner", hint: "Runs the household, including its owners" },
  admin: { label: "Admin", hint: "Manages the library, settings and members" },
  member: { label: "Member", hint: "Watches; can't change anything" },
};

export function primaryRole(role: string): HouseholdRole {
  const roles = role.split(",");
  return roles.includes("owner") ? "owner" : roles.includes("admin") ? "admin" : "member";
}

const AVATAR_FILLS = ["var(--sand)", "var(--primary)", "var(--local)", "var(--torbox)"];

/** Same pick as the apps (FNV-1a over the account id), so a person has one color everywhere. */
function avatarFill(id: string): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(id)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return AVATAR_FILLS[hash % AVATAR_FILLS.length]!;
}

export function Avatar({ id, name }: { id: string; name: string }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-base font-semibold text-black/80" aria-hidden="true" style={{ background: avatarFill(id) }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Emails setup made up for accounts created without one. */
const placeholderEmail = (email: string) => email.endsWith("@users.strata");

export function useHousehold() {
  return useQuery({ queryKey: queryKeys.household, queryFn: authClient.getHousehold });
}

/** The active household's people: role, kids flag and content limit, removal. */
/** Owner 2, admin 1, member 0 (as the server ranks them for password resets). */
const rank = (role: string | undefined) => ((role ?? "").split(",").includes("owner") ? 2 : (role ?? "").split(",").includes("admin") ? 1 : 0);

export function MemberList({ selfId }: { selfId: string }) {
  const { authChanged, me, isServerAdmin } = useSession();
  const [resetting, setResetting] = useState<{ userId: string; name: string } | null>(null);
  // Who you may reset: someone below you here (the server's admin: anyone else).
  const canReset = (m: Member) => m.userId !== selfId && (isServerAdmin || rank(m.role) < rank(me.household?.role));
  const household = useHousehold();
  const [removing, setRemoving] = useState<Member | null>(null);
  const [showingCode, setShowingCode] = useState<{ id: string; name: string } | null>(null);
  const [renaming, setRenaming] = useState<Member | null>(null);
  const setRole = useApiMutation(({ m, role }: { m: Member; role: HouseholdRole }) => authClient.setMemberRole(m.id, role), {
    success: (_, { m, role }) => `${m.user.name}'s role is now ${ROLE_LABELS[role].label}`,
    invalidate: [queryKeys.household],
  });
  const update = useApiMutation(({ m, patch }: { m: Member; patch: { name?: string; contentLimit?: ContentLimit; isKids?: boolean } }) => api.updateMember(m.id, patch), {
    success: (res, { m }) => (res.name && res.name !== m.user.name ? `Renamed ${m.user.name} to ${res.name}` : `Saved ${m.user.name}`),
    invalidate: [queryKeys.household],
  });
  const remove = useApiMutation((m: Member) => authClient.removeMember(m.id), { success: (_, m) => `Removed ${m.user.name}`, invalidate: [queryKeys.household] });

  if (household.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  if (!household.data) return <ErrorAlert error={household.error} title="Couldn't load the household" onRetry={() => void household.refetch()} />;
  const members = household.data.members;
  if (members.length === 0) return <EmptyState icon={Users} title="No members yet" />;

  return (
    <>
      <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_8rem_11rem_4.5rem_4.5rem] items-center gap-4 px-4 pb-2 text-xs font-medium lg:grid">
        <span>Person</span>
        <span>Role</span>
        <span>Can watch</span>
        <span>Kids</span>
        <span className="sr-only">Actions</span>
      </div>
      <ul className="divide-y overflow-hidden rounded-lg border">
        {members.map((m) => {
          const self = m.userId === selfId;
          const role = primaryRole(m.role);
          const limit = m.contentLimit ?? "none";
          const email = placeholderEmail(m.user.email) ? null : m.user.email;
          return (
            <li key={m.id} className="hover:bg-muted/30 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3 transition-colors lg:grid-cols-[minmax(0,1fr)_8rem_11rem_4.5rem_4.5rem]">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar id={m.userId} name={m.user.name} />
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-2 font-medium">
                    <span className="truncate">{m.user.name}</span>
                    {self && <Badge variant="secondary">You</Badge>}
                    {m.isKids && <Badge variant="success">Kids</Badge>}
                  </p>
                  <p className="text-muted-foreground truncate text-xs" title={new Date(m.createdAt).toLocaleString()}>
                    {email ? `${email} · ` : ""}Joined {relativeTime(new Date(m.createdAt).getTime())}
                  </p>
                </div>
              </div>

              {/* Actions sit beside the name on small screens, last on wide ones. */}
              <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 lg:col-start-5">
                <Button variant="ghost" size="icon-sm" onClick={() => setShowingCode({ id: m.id, name: m.user.name })} aria-label={`Sign-in code for ${m.user.name}`} title="Sign-in QR code">
                  <QrCodeIcon />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`More for ${m.user.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => setRenaming(m)}>
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setShowingCode({ id: m.id, name: m.user.name })}>
                      <QrCodeIcon /> Sign-in code
                    </DropdownMenuItem>
                    {canReset(m) && (
                      <DropdownMenuItem onSelect={() => setResetting({ userId: m.userId, name: m.user.name })}>
                        <KeyRound /> Reset password…
                      </DropdownMenuItem>
                    )}
                    {!self && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(m)}>
                          <Trash /> Remove from household
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="col-span-2 flex flex-wrap items-center gap-3 pl-13 lg:contents">
                <div className="lg:col-start-2 lg:row-start-1">
                  {self ? (
                    <span className="text-muted-foreground text-sm" title="You can't change your own role">
                      {ROLE_LABELS[role].label}
                    </span>
                  ) : (
                    <Select value={role} disabled={setRole.isPending && setRole.variables?.m.id === m.id} onValueChange={(v) => setRole.mutate({ m, role: v as HouseholdRole })}>
                      <SelectTrigger size="sm" className="w-32" aria-label={`Role of ${m.user.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ROLE_LABELS) as HouseholdRole[]).map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="lg:col-start-3 lg:row-start-1">
                  <Select value={limit} onValueChange={(v) => update.mutate({ m, patch: { contentLimit: v as ContentLimit } })}>
                    <SelectTrigger size="sm" className="w-44" aria-label={`What ${m.user.name} can watch`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(LIMIT_LABELS) as ContentLimit[]).map((key) => (
                        <SelectItem key={key} value={key}>
                          {LIMIT_LABELS[key].short}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 lg:col-start-4 lg:row-start-1">
                  <Switch id={`kids-${m.id}`} checked={!!m.isKids} onCheckedChange={(on) => update.mutate({ m, patch: { isKids: on } })} aria-label={`${m.user.name} is a kid`} />
                  <Label htmlFor={`kids-${m.id}`} className="font-normal lg:sr-only">
                    Kids
                  </Label>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <SignInCodeDialog member={showingCode} onOpenChange={(o) => !o && setShowingCode(null)} />
      <ResetPasswordDialog member={resetting} onOpenChange={(o) => !o && setResetting(null)} />
      <RenameMemberDialog
        key={renaming?.id}
        member={renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        onSave={(name) =>
          renaming
            ? update.mutateAsync({ m: renaming, patch: { name } }).then(async () => {
                // Your own name shows in the top bar too.
                if (renaming.userId === selfId) await authChanged();
                setRenaming(null);
              })
            : undefined
        }
        pending={update.isPending}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Remove ${removing.user.name}?` : "Remove member?"}
        description="They lose access to this household's library on every device. Their account stays; invite them again to bring them back."
        confirmLabel="Remove"
        onConfirm={() => (removing ? remove.mutateAsync(removing) : undefined)}
      />
    </>
  );
}

/** Pending invitations of the active household, with their links. */
export function InvitationList({ compact }: { compact?: boolean }) {
  const household = useHousehold();
  const cancel = useApiMutation((inv: Invitation) => authClient.cancelInvitation(inv.id), { success: (_, inv) => `Canceled the invitation for ${inv.email}`, invalidate: [queryKeys.household] });
  const pending = (household.data?.invitations ?? []).filter((i) => i.status === "pending" && new Date(i.expiresAt).getTime() > Date.now());
  if (!household.data) return null;
  if (pending.length === 0) {
    return compact ? null : (
      <p className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm">
        <Mail className="size-4" /> None waiting. Invite someone and pass them the link; it works for a week.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-lg border">
      {pending.map((inv) => (
        <li key={inv.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-sm font-medium">
              {inv.email}
              <Badge variant="secondary">{ROLE_LABELS[primaryRole(inv.role)].label}</Badge>
            </p>
            <p className="text-muted-foreground text-xs">Expires {relativeTime(new Date(inv.expiresAt).getTime())}</p>
          </div>
          <div className="flex gap-1">
            <CopyButton value={invitationLink(inv.id)} label="Copy link" />
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => cancel.mutate(inv)} disabled={cancel.isPending && cancel.variables?.id === inv.id}>
              <X /> Cancel
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link instead");
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()}>
      {copied ? <Check /> : <Copy />}
      {label}
    </Button>
  );
}

/** The link to pass on, selectable and copyable. */
export function LinkBox({ link }: { link: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" />
      <CopyButton value={link} />
    </div>
  );
}

/** Invite someone by email with a role; shows the link to pass on (no mail is sent). */
export function InviteDialog({
  open,
  onOpenChange,
  householdId,
  householdName,
  defaultRole = "member",
  allowOwner = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Another household than the active one (the server admin inviting a new household's owner). */
  householdId?: string;
  householdName?: string;
  defaultRole?: HouseholdRole;
  allowOwner?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{householdName ? `Invite someone to ${householdName}` : "Invite someone"}</DialogTitle>
          <DialogDescription>Strata doesn't send email: you'll get a link to pass on. It works for a week, for this email only.</DialogDescription>
        </DialogHeader>
        {open && <InviteForm householdId={householdId} defaultRole={defaultRole} allowOwner={allowOwner} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ householdId, defaultRole, allowOwner, onDone }: { householdId?: string; defaultRole: HouseholdRole; allowOwner: boolean; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<HouseholdRole>(defaultRole);
  const [touched, setTouched] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const invite = useApiMutation(() => authClient.invite({ email: email.trim().toLowerCase(), role, householdId }), {
    silentError: true,
    invalidate: [queryKeys.household],
    onSuccess: (inv) => setLink(invitationLink(inv.id)),
  });
  const emailError = touched && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "Enter their email address." : null;

  if (link) {
    return (
      <FieldGroup>
        <p className="text-sm">
          Send this link to <span className="font-medium">{email.trim()}</span>. Opening it lets them create their account (or sign in to an existing one) and join.
        </p>
        <LinkBox link={link} />
        <DialogFooter>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </FieldGroup>
    );
  }

  const roles: HouseholdRole[] = allowOwner ? ["owner", "admin", "member"] : ["admin", "member"];
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return;
        invite.mutate();
      }}
    >
      <FieldGroup>
        <FormField label="Email" description="They sign up with this address." error={emailError}>
          {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoFocus />}
        </FormField>
        <FormField label="Role" description={ROLE_LABELS[role].hint}>
          {(p) => (
            <Select value={role} onValueChange={(v) => setRole(v as HouseholdRole)}>
              <SelectTrigger {...p} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <InlineError error={invite.error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? <LoaderCircle className="animate-spin" /> : <UserPlus />}
            Create invitation
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

/** A member's name: the account's, so it changes on every device they use. */
function RenameMemberDialog({
  member,
  onOpenChange,
  onSave,
  pending,
}: {
  member: Member | null;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => unknown;
  pending: boolean;
}) {
  const [name, setName] = useState(member?.user.name ?? "");
  const trimmed = name.trim();
  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {member?.user.name}</DialogTitle>
          <DialogDescription>The name the apps show for them, on every device they use.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed && trimmed !== member?.user.name) onSave(trimmed);
            else onOpenChange(false);
          }}
        >
          <FieldGroup>
            <FormField label="Name" error={name && !trimmed ? "Give them a name." : null}>
              {(p) => <Input {...p} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} autoFocus />}
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !trimmed}>
                {pending && <LoaderCircle className="animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
