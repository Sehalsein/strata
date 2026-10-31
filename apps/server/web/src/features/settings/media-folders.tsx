import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CornerLeftUp, Folder, FolderPlus, LoaderCircle, Trash } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import type { MediaFolder, MediaFolderKind } from "@/lib/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, InlineError } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const KINDS: { value: MediaFolderKind; label: string }[] = [
  { value: "auto", label: "Mixed (auto-detect)" },
  { value: "movies", label: "Movies" },
  { value: "shows", label: "TV shows" },
];

/** Editable list of media folders with a server-side folder picker. Controlled. */
export function MediaFolders({ value, onChange }: { value: MediaFolder[]; onChange: (next: MediaFolder[]) => void }) {
  const [browsing, setBrowsing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const add = (path: string, kind: MediaFolderKind) => {
    if (value.some((f) => f.path === path)) return;
    onChange([...value, { path, kind }]);
  };

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? (
        <EmptyState icon={Folder} title="No folders yet" description="Add the folders that hold your movies and shows." className="py-8" />
      ) : (
        <ul className="divide-y rounded-lg border">
          {value.map((f, i) => (
            <li key={f.path} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Folder className="text-muted-foreground size-4 shrink-0" />
                <code className="truncate text-sm" title={f.path}>
                  <bdi dir="ltr">{f.path}</bdi>
                </code>
              </div>
              <div className="flex items-center gap-2">
                <Select value={f.kind} onValueChange={(k) => onChange(value.map((x, j) => (j === i ? { ...x, kind: k as MediaFolderKind } : x)))}>
                  <SelectTrigger size="sm" className="w-48" aria-label={`Content type for ${f.path}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => setRemoving(f.path)} aria-label={`Remove ${f.path}`}>
                  <Trash />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button variant="outline" onClick={() => setBrowsing(true)}>
          <FolderPlus /> Add folder…
        </Button>
      </div>
      <FolderBrowserDialog
        open={browsing}
        onOpenChange={setBrowsing}
        existing={value.map((f) => f.path)}
        onPick={(path, kind) => {
          add(path, kind);
          setBrowsing(false);
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this folder?"
        description={
          <>
            <code className="break-all">{removing}</code> stops being scanned once you save. Files on disk aren't touched.
          </>
        }
        confirmLabel="Remove folder"
        onConfirm={() => onChange(value.filter((f) => f.path !== removing))}
      />
    </div>
  );
}

function FolderBrowserDialog({ open, onOpenChange, onPick, existing }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (path: string, kind: MediaFolderKind) => void; existing: string[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a folder</DialogTitle>
          <DialogDescription>Folders on the server. Network shares mounted on it work too.</DialogDescription>
        </DialogHeader>
        {open && <FolderBrowser existing={existing} onPick={onPick} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

let lastBrowsedPath: string | undefined;

function FolderBrowser({ existing, onPick, onCancel }: { existing: string[]; onPick: (path: string, kind: MediaFolderKind) => void; onCancel: () => void }) {
  const [path, setPath] = useState<string | undefined>(lastBrowsedPath);
  const [typed, setTyped] = useState(lastBrowsedPath ?? "");
  const [kind, setKind] = useState<MediaFolderKind>("auto");
  const listing = useQuery({ queryKey: queryKeys.fs(path), queryFn: () => api.fs(path), staleTime: 10_000 });
  const l = listing.data;

  const go = (p: string) => {
    setPath(p);
    setTyped(p);
    lastBrowsedPath = p;
  };
  // Keep the address bar in sync with the folder the server resolved (e.g. the home folder).
  if (l && path === undefined && typed === "") setTyped(l.path);

  const already = l ? existing.includes(l.path) : false;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) go(typed.trim());
        }}
      >
        <Input aria-label="Folder path" className="font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
        <Button type="submit" variant="secondary">
          Go
        </Button>
      </form>

      {l && l.shortcuts.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Shortcuts">
          {l.shortcuts.map((s) => (
            <Button key={s.path} variant="outline" size="sm" className="h-7 rounded-full" onClick={() => go(s.path)}>
              {s.name}
            </Button>
          ))}
        </div>
      )}

      <InlineError error={listing.error} />

      <div className="h-72 overflow-y-auto rounded-md border" aria-busy={listing.isFetching}>
        {listing.isPending ? (
          <div className="flex flex-col gap-1 p-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : l ? (
          <ul className="p-1">
            {l.parent && (
              <li>
                <button type="button" className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm" onClick={() => go(l.parent!)}>
                  <CornerLeftUp className="text-muted-foreground size-4" />
                  <span>Parent folder</span>
                </button>
              </li>
            )}
            {l.dirs.map((d) => (
              <li key={d.path}>
                <button type="button" className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm" onClick={() => go(d.path)}>
                  <Folder className="text-muted-foreground size-4 shrink-0" />
                  <span className="flex-1 truncate">{d.name}</span>
                  <ChevronRight className="text-muted-foreground size-4" />
                </button>
              </li>
            ))}
            {l.dirs.length === 0 && <li className="text-muted-foreground p-4 text-center text-sm">No subfolders here.</li>}
          </ul>
        ) : null}
      </div>

      <DialogFooter className="items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Label htmlFor="browser-kind" className="text-muted-foreground font-normal">
            Contains
          </Label>
          <Select value={kind} onValueChange={(v) => setKind(v as MediaFolderKind)}>
            <SelectTrigger id="browser-kind" size="sm" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!l || already || listing.isFetching} onClick={() => l && onPick(l.path, kind)}>
            {listing.isFetching && <LoaderCircle className="animate-spin" />}
            {already ? "Already added" : "Add this folder"}
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}
