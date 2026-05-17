import { Gauge } from "lucide-react";
import { memo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { ControlButton, ControlMenuTrigger } from "./ControlButton";

const PRESETS = [1, 1.5, 2] as const;
const LADDER = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const fmt = (r: number): string => (r === 1 ? "1.0×" : `${r}×`);

type Props = {
  rate: number;
  onChange: (rate: number) => void;
  onCycle: () => void;
};

export const SpeedButton = memo(function SpeedButton({
  rate,
  onChange,
  onCycle,
}: Props) {
  return (
  <DropdownMenu>
    <ControlButton
      icon={<Gauge className="h-4 w-4" />}
      label="Speed"
      value={fmt(rate)}
      ariaLabel="Cycle playback speed"
      active={Math.abs(rate - 1) > 0.01}
      onClick={onCycle}
      menuSlot={
        <DropdownMenuTrigger asChild>
          <ControlMenuTrigger ariaLabel="Playback speed menu" />
        </DropdownMenuTrigger>
      }
    />
    <DropdownMenuContent align="end" className="min-w-[14rem]">
      <DropdownMenuLabel>Playback speed</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <div className="flex gap-1 px-1 pb-1">
        {PRESETS.map((p) => {
          const active = Math.abs(p - rate) < 0.01;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={cn(
                "flex-1 rounded-sm border px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition",
                active
                  ? "border-strata-accent bg-strata-accent/15 text-strata-paper"
                  : "border-strata-paper/15 bg-transparent text-strata-paper/75 hover:border-strata-paper/40 hover:text-strata-paper",
              )}
            >
              {fmt(p)}
            </button>
          );
        })}
      </div>
      <DropdownMenuSeparator />
      {LADDER.map((s) => (
        <DropdownMenuItem
          key={s}
          active={Math.abs(s - rate) < 0.01}
          onSelect={() => onChange(s)}
        >
          {fmt(s)}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
  );
});
