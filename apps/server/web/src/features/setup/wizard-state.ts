import { authClient } from "@/lib/auth-client";

export const STEPS = [
  { key: "welcome", label: "Welcome" },
  { key: "account", label: "Admin account" },
  { key: "services", label: "Connect services" },
  { key: "basics", label: "Server basics" },
  { key: "profiles", label: "Profiles" },
  { key: "devices", label: "Your devices" },
  { key: "done", label: "Finish" },
] as const;

/** Steps from here on run signed in with the token the account step got. */
export const FIRST_AUTHED_STEP = 2;

const STEP_KEY = "strata.setupStep";

export function storedStep(): number | null {
  try {
    const v = localStorage.getItem(STEP_KEY);
    if (v === null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : null;
  } catch {
    return null;
  }
}

export function storeStep(n: number | null) {
  try {
    if (n === null) localStorage.removeItem(STEP_KEY);
    else localStorage.setItem(STEP_KEY, String(n));
  } catch {
    /* storage unavailable: a reload starts the remaining steps over */
  }
}

/** True when the admin exists (we hold its token) but the remaining steps aren't finished. */
export function wizardInProgress(): boolean {
  const s = storedStep();
  return s !== null && s >= FIRST_AUTHED_STEP && authClient.hasSession();
}

/** Rough strength for the hint under the password field. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes >= 2) score++;
  if (classes >= 3 && pw.length >= 10) score++;
  if (pw.length < 8) score = Math.min(score, 1);
  const s = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  return { score: s, label: ["Too short", "Weak", "Fair", "Good", "Strong"][s]! };
}
