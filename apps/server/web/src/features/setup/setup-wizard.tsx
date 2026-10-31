import { useState } from "react";
import { Check } from "lucide-react";
import type { ServerInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { Progress } from "@/components/ui/progress";
import { AccountStep, WelcomeStep } from "./steps-intro";
import { BasicsStep, ServicesStep } from "./steps-config";
import { DevicesStep, DoneStep, PeopleStep } from "./steps-finish";
import { FIRST_AUTHED_STEP, STEPS, storeStep, storedStep } from "./wizard-state";

function initialStep(info: ServerInfo): number {
  const stored = storedStep();
  // Before the admin exists only Welcome and Account make sense.
  if (info.setupRequired) return Math.min(stored ?? 0, FIRST_AUTHED_STEP - 1);
  return Math.max(stored ?? FIRST_AUTHED_STEP, FIRST_AUTHED_STEP);
}

export interface StepProps {
  info: ServerInfo;
  onNext: () => void;
  onBack?: () => void;
}

/**
 * First-run setup: a guided, resumable wizard. The step is kept in localStorage so a reload
 * picks up where it left off; once the admin account exists every later step runs signed in.
 */
export default function SetupWizard({ info, onDone, onAccountCreated }: { info: ServerInfo; onDone: (to?: string) => void; onAccountCreated: () => void }) {
  const [step, setStepState] = useState(() => initialStep(info));
  const [maxReached, setMaxReached] = useState(step);

  const setStep = (n: number) => {
    setStepState(n);
    setMaxReached((m) => Math.max(m, n));
    storeStep(n);
    window.scrollTo(0, 0);
  };
  const next = () => setStep(Math.min(step + 1, STEPS.length - 1));
  const back = step > FIRST_AUTHED_STEP || step === 1 ? () => setStep(step - 1) : undefined;

  const finish = (to?: string) => {
    storeStep(null);
    onDone(to);
  };

  const canJump = (i: number) => i !== step && i <= maxReached && (i >= FIRST_AUTHED_STEP) === (step >= FIRST_AUTHED_STEP);

  return (
    <div className="bg-muted/30 min-h-svh">
      <header className="flex items-center justify-between px-4 py-4 md:px-8">
        <div className="flex items-center gap-2 font-semibold">
          <BrandMark size={26} />
          <span>Strata</span>
          <span className="text-muted-foreground text-sm font-normal">
            · Server setup{info.version ? <span className="font-mono"> v{info.version}</span> : null}
          </span>
        </div>
        <ModeToggle />
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 pb-16 md:grid-cols-[13rem_1fr] md:px-8">
        <nav aria-label="Setup steps" className="hidden md:block">
          <ol className="flex flex-col gap-1">
            {STEPS.map((s, i) => {
              const done = i < step;
              const current = i === step;
              const jumpable = canJump(i);
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    disabled={!jumpable}
                    onClick={() => setStep(i)}
                    aria-current={current ? "step" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      current ? "bg-background font-medium shadow-xs" : "text-muted-foreground",
                      jumpable && "hover:bg-background/60 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                        current && "border-primary bg-primary text-primary-foreground",
                        done && "border-primary/40 bg-primary/15 text-brand-text",
                      )}
                    >
                      {done ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main id="main" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-2 md:hidden">
            <p className="text-muted-foreground text-xs font-medium">
              Step {step + 1} of {STEPS.length} · {STEPS[step]!.label}
            </p>
            <Progress value={((step + 1) / STEPS.length) * 100} aria-label="Setup progress" />
          </div>
          {step === 0 && <WelcomeStep info={info} onNext={next} />}
          {step === 1 && (
            <AccountStep
              info={info}
              onBack={back}
              onNext={() => {
                onAccountCreated();
                setStep(FIRST_AUTHED_STEP);
              }}
            />
          )}
          {step === 2 && <ServicesStep info={info} onNext={next} />}
          {step === 3 && <BasicsStep info={info} onBack={back} onNext={next} />}
          {step === 4 && <PeopleStep info={info} onBack={back} onNext={next} />}
          {step === 5 && <DevicesStep info={info} onBack={back} onNext={next} />}
          {step === 6 && <DoneStep info={info} onBack={back} onFinish={finish} />}
        </main>
      </div>
    </div>
  );
}
