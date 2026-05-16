import { Captions, CaptionsOff } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { ControlButton, ControlMenuTrigger } from "./ControlButton";
import type { Stream } from "./types";

const langCode = (s: Stream | undefined): string => {
  if (!s) return "—";
  return (s.Language ?? "").toUpperCase().slice(0, 3) || "TRK";
};

const trackLabel = (s: Stream): string =>
  s.DisplayTitle ?? s.Language ?? `Track ${s.Index}`;

type Props = {
  tracks: Stream[];
  current: number | "off";
  onChange: (value: number | "off") => void;
  onToggle: () => void;
};

export const CaptionsButton = ({ tracks, current, onChange, onToggle }: Props) => {
  if (tracks.length === 0) return null;
  const on = current !== "off";
  const active = on ? tracks.find((t) => t.Index === current) : null;

  return (
    <DropdownMenu>
      <ControlButton
        icon={on ? <Captions className="h-4 w-4" /> : <CaptionsOff className="h-4 w-4" />}
        label="CC"
        value={on ? langCode(active ?? undefined) : "Off"}
        ariaLabel={on ? "Turn off captions" : "Turn on captions"}
        active={on}
        onClick={onToggle}
        menuSlot={
          <DropdownMenuTrigger asChild>
            <ControlMenuTrigger ariaLabel="Caption tracks" />
          </DropdownMenuTrigger>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Subtitles</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          active={current === "off"}
          onSelect={() => onChange("off")}
        >
          Off
        </DropdownMenuItem>
        {tracks.map((s) => (
          <DropdownMenuItem
            key={s.Index}
            active={s.Index === current}
            onSelect={() => onChange(s.Index)}
          >
            {trackLabel(s)}
            {s.IsForced ? " (Forced)" : ""}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
