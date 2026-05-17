import { AudioLines } from "lucide-react";
import { memo } from "react";
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

const trackLabel = (s: Stream): string =>
  s.DisplayTitle ?? s.Language ?? `Track ${s.Index}`;

const compactValue = (s: Stream | undefined): string => {
  if (!s) return "—";
  const lang = (s.Language ?? "").toUpperCase().slice(0, 3);
  const codec = (s.Codec ?? "").toUpperCase();
  const display = s.DisplayTitle ?? "";
  const channelMatch = display.match(/(5\.1|7\.1|Atmos|Stereo|Mono|2\.0)/i);
  const ch = channelMatch ? channelMatch[0].toUpperCase() : codec || null;
  return ch ? `${lang || "TRK"} · ${ch}` : lang || "TRK";
};

type Props = {
  tracks: Stream[];
  current: number | undefined;
  onChange: (index: number) => void;
};

export const AudioButton = memo(function AudioButton({
  tracks,
  current,
  onChange,
}: Props) {
  if (tracks.length === 0) return null;
  const active = tracks.find((t) => t.Index === current);

  // Click cycles when there are exactly 2 tracks (a common dual-language
  // setup); 3+ opens the dropdown directly.
  const primaryAction =
    tracks.length === 2
      ? () => {
          const other = tracks.find((t) => t.Index !== current) ?? tracks[0]!;
          onChange(other.Index);
        }
      : undefined;

  const hasMultiple = tracks.length > 1;

  return (
    <DropdownMenu>
      <ControlButton
        icon={<AudioLines className="h-4 w-4" />}
        label="Audio"
        value={compactValue(active)}
        ariaLabel="Audio track"
        disabled={!hasMultiple}
        onClick={primaryAction}
        menuSlot={
          hasMultiple ? (
            <DropdownMenuTrigger asChild>
              <ControlMenuTrigger ariaLabel="Audio tracks" />
            </DropdownMenuTrigger>
          ) : null
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Audio</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tracks.map((a) => (
          <DropdownMenuItem
            key={a.Index}
            active={a.Index === current}
            onSelect={() => onChange(a.Index)}
          >
            {trackLabel(a)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
