import { useState } from "react";
import { Check } from "lucide-react";
import type { ServerInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { AccountStep, HouseholdStep, WelcomeStep } from "./steps-intro";
import { BasicsStep, ServicesStep } from "./steps-config";
import { DevicesStep, DoneStep, PeopleStep } from "./steps-finish";
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
    <div className="bg-muted/30 flex min-h-svh flex-col">
      <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <BrandMark size={24} />
            <span>Strata</span>
            <span className="text-muted-foreground hidden text-sm font-normal sm:inline">· {cloud ? "Getting started" : "Server setup"}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-xs font-medium tabular-nums">
              Step {step + 1} of {steps.length}
            </span>
            <ModeToggle />
          </div>
        </div>
        <Stepper steps={steps} step={step} canJump={canJump} onJump={setStep} />
      </header>

      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:py-12">
        <div key={key} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
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
  );
}

/** The steps in a row: numbered dots joined by a line that fills as you go; names from small screens up. */
function Stepper({ steps, step, canJump, onJump }: { steps: WizardStep[]; step: number; canJump: (i: number) => boolean; onJump: (i: number) => void }) {
  return (
    <nav aria-label="Steps" className="mx-auto max-w-3xl px-4 pt-1 pb-4">
      <ol className="flex items-start">
        {steps.map((s, i) => {
          const done = i < step;
          const current = i === step;
          const jumpable = canJump(i);
          return (
            <li key={s.key} className="relative flex flex-1 flex-col items-center">
              {i > 0 && (
                <span aria-hidden="true" className="bg-border absolute top-3.5 right-[calc(50%+1.125rem)] left-[calc(-50%+1.125rem)] h-0.5 -translate-y-1/2 overflow-hidden rounded-full">
                  <span className={cn("bg-primary block h-full transition-all duration-500", i <= step ? "w-full" : "w-0")} />
                </span>
              )}
              <button
                type="button"
                disabled={!jumpable}
                onClick={() => onJump(i)}
                aria-current={current ? "step" : undefined}
                aria-label={`${s.label}${done ? " (done)" : ""}`}
                className={cn("group relative flex flex-col items-center gap-1.5 rounded-md outline-none", jumpable && "cursor-pointer")}
              >
                <span
                  className={cn(
                    "bg-background text-muted-foreground flex size-7 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors group-focus-visible:ring-ring/50 group-focus-visible:ring-[3px]",
                    current && "border-primary bg-primary text-primary-foreground ring-primary/20 ring-4",
                    done && "border-primary bg-primary text-primary-foreground",
                    jumpable && !current && "group-hover:border-primary/70",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn("hidden text-xs whitespace-nowrap sm:block", current ? "text-foreground font-medium" : "text-muted-foreground", jumpable && "group-hover:text-foreground")}>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
