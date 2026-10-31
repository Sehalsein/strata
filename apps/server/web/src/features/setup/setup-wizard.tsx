import { useState } from "react";
import type { ServerInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { AccountStep, HouseholdStep, WelcomeStep } from "./steps-intro";
import { BasicsStep, ServicesStep } from "./steps-config";
import { DevicesStep, DoneStep, PeopleStep } from "./steps-finish";
import { WizardContext } from "./step-card";
import { firstAuthedStep, storeStep, storedStep, wizardSteps, type WizardStep } from "./wizard-state";

function initialStep(info: ServerInfo): number {
  const cloud = info.mode === "cloud";
  const stored = storedStep(cloud);
  const first = firstAuthedStep(cloud);
  // Before a home server's admin exists only Welcome and Account make sense.
  if (info.setupRequired) return Math.min(stored ?? 0, first - 1);
  return Math.max(stored ?? first, first);
}

export interface StepProps {
  info: ServerInfo;
  onNext: () => void;
  onBack?: () => void;
}

/**
 * Onboarding: a guided, resumable flow with its steps across the top. A home server's
 * first run makes the admin's account, then sets up the server and their household; a new
 * cloud account (signed up, with a household of its own) sets up that household. The step
 * is kept in localStorage so a reload picks up where it left off.
 */
export default function SetupWizard({ info, onDone, onAccountCreated }: { info: ServerInfo; onDone: (to?: string) => void; onAccountCreated: () => void }) {
  const cloud = info.mode === "cloud";
  const steps = wizardSteps(cloud);
  const first = firstAuthedStep(cloud);
  const [step, setStepState] = useState(() => initialStep(info));
  const [maxReached, setMaxReached] = useState(step);

  const setStep = (n: number) => {
    setStepState(n);
    setMaxReached((m) => Math.max(m, n));
    storeStep(n);
    window.scrollTo(0, 0);
  };
  const next = () => setStep(Math.min(step + 1, steps.length - 1));
  const back = step > first || (step === 1 && !cloud) ? () => setStep(step - 1) : undefined;

  const finish = (to?: string) => {
    storeStep(null);
    onDone(to);
  };

  // Steps reached before can be revisited, never back across making the account.
  const canJump = (i: number) => i !== step && i <= maxReached && (i >= first) === (step >= first);
  const key = steps[step]!.key;

  return (
    <WizardContext.Provider value={{ index: step, total: steps.length, label: steps[step]!.label }}>
      <div className="bg-background relative flex min-h-svh flex-col overflow-x-clip">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent)]" />
        <header className="relative z-10">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 pt-5 sm:px-8">
            <div className="flex items-center gap-2 font-semibold">
              <BrandMark size={26} />
              <span className="text-lg">Strata</span>
            </div>
            <ModeToggle />
          </div>
          <Stepper steps={steps} step={step} canJump={canJump} onJump={setStep} />
        </header>

        <main id="main" className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pt-10 sm:px-8 sm:pt-16">
          <div key={key} className="animate-in fade-in slide-in-from-bottom-3 flex flex-1 flex-col duration-500">
            {key === "welcome" && <WelcomeStep info={info} onNext={next} />}
            {key === "account" && (
              <AccountStep
                info={info}
                onBack={back}
                onNext={() => {
                  onAccountCreated();
                  setStep(first);
                }}
              />
            )}
            {key === "household" && <HouseholdStep info={info} onNext={next} />}
            {key === "services" && <ServicesStep info={info} onBack={back} onNext={next} />}
            {key === "basics" && <BasicsStep info={info} onBack={back} onNext={next} />}
            {key === "people" && <PeopleStep info={info} onBack={back} onNext={next} />}
            {key === "devices" && <DevicesStep info={info} onBack={back} onNext={next} />}
            {key === "done" && <DoneStep info={info} onBack={back} onFinish={finish} />}
          </div>
        </main>
      </div>
    </WizardContext.Provider>
  );
}

/** The steps as segments of one bar, each filling as it's reached; names under it from small screens up. */
function Stepper({ steps, step, canJump, onJump }: { steps: WizardStep[]; step: number; canJump: (i: number) => boolean; onJump: (i: number) => void }) {
  return (
    <nav aria-label="Steps" className="mx-auto max-w-4xl px-5 pt-6 sm:px-8">
      <ol className="flex gap-1.5 sm:gap-2">
        {steps.map((s, i) => {
          const current = i === step;
          const jumpable = canJump(i);
          return (
            <li key={s.key} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={!jumpable}
                onClick={() => onJump(i)}
                aria-current={current ? "step" : undefined}
                aria-label={`Step ${i + 1}: ${s.label}`}
                className={cn("group flex w-full flex-col gap-2 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", jumpable && "cursor-pointer")}
              >
                <span className="bg-foreground/10 block h-1 w-full overflow-hidden rounded-full">
                  <span className={cn("bg-primary block h-full rounded-full transition-[width] duration-500 ease-out", i <= step ? "w-full" : "w-0", i === step && "shadow-[0_0_12px_var(--primary)]")} />
                </span>
                <span className={cn("hidden truncate text-xs transition-colors sm:block", current ? "text-foreground font-medium" : i < step ? "text-muted-foreground" : "text-muted-foreground/60", jumpable && "group-hover:text-foreground")}>
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
