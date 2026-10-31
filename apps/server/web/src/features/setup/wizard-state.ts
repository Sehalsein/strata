export interface WizardStep {
  key: "welcome" | "account" | "household" | "services" | "basics" | "people" | "devices" | "done";
  label: string;
}

/** A home server's first run: the admin's account, then the server and their household. */
const HOME_STEPS: WizardStep[] = [
  { key: "welcome", label: "Welcome" },
  { key: "account", label: "Admin account" },
  { key: "services", label: "Services" },
  { key: "basics", label: "Server" },
  { key: "people", label: "People" },
  { key: "devices", label: "Devices" },
  { key: "done", label: "Finish" },
];

/** A new cloud account (already signed in, with a household of its own): setting it up. */
const CLOUD_STEPS: WizardStep[] = [
  { key: "household", label: "Household" },
  { key: "services", label: "Services" },
  { key: "people", label: "People" },
  { key: "devices", label: "Devices" },
  { key: "done", label: "Finish" },
];

export const wizardSteps = (cloud: boolean) => (cloud ? CLOUD_STEPS : HOME_STEPS);

/** Steps from here on run signed in (home: with the token the account step got). */
export const firstAuthedStep = (cloud: boolean) => (cloud ? 0 : 2);

const STEP_KEY = "strata.setupStep";

export function storedStep(cloud: boolean): number | null {
  try {
    const v = localStorage.getItem(STEP_KEY);
    if (v === null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n < wizardSteps(cloud).length ? n : null;
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

/** True when signed in but the remaining steps aren't finished (home: after the admin exists; cloud: after signing up). */
export function wizardInProgress(cloud: boolean): boolean {
  const s = storedStep(cloud);
  return s !== null && s >= firstAuthedStep(cloud);
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
