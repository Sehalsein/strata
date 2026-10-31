import { useState } from "react";
import { Download, LoaderCircle, Trash } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/app/session";
import { errorMessage, privacyUrl } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

/**
 * The signed-in person's data: download everything kept about them (JSON), or delete
 * their account and all of it. Deleting asks for the password.
 */
export function YourDataDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { me, info, authChanged } = useSession();
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/me/export", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Couldn't make the file (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "strata-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await authClient.deleteAccount(password);
      onOpenChange(false);
      toast.success("Your account is deleted.");
      await authChanged();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setDeleting(false);
          setPassword("");
          setError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your data</DialogTitle>
          <DialogDescription>
            Everything this server keeps about {me.user.name}.{" "}
            <a href={privacyUrl(info)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              What's kept and why
            </a>
          </DialogDescription>
        </DialogHeader>

        <section className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Download my data</p>
            <p className="text-muted-foreground text-sm">Your account, households, devices, watch history and My List, as a JSON file.</p>
          </div>
          <Button variant="outline" onClick={() => void download()} disabled={downloading}>
            {downloading ? <LoaderCircle className="animate-spin" /> : <Download />} Download
          </Button>
        </section>

        <Separator />

        {!deleting ? (
          <section className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">Delete account</p>
              <p className="text-muted-foreground text-sm">Removes your account and everything kept about you, and signs out every device. It can't be undone.</p>
            </div>
            <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>
              <Trash /> Delete
            </Button>
          </section>
        ) : (
          <form onSubmit={remove} className="flex flex-col gap-3" noValidate>
            <Alert variant="destructive">
              <AlertDescription>
                This deletes {me.user.name}'s account, watch history, My List and sign-ins for good. A household with nobody else in it is deleted too, with its library and settings.
              </AlertDescription>
            </Alert>
            <FormField label="Your password, to confirm" error={error}>
              {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />}
            </FormField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDeleting(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={pending || !password}>
                {pending && <LoaderCircle className="animate-spin" />}
                Delete my account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
