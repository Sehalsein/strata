import { useMemo } from "react";
import { renderSVG } from "uqr";
import { cn } from "@/lib/utils";

/** A QR code for `value`, black on white so phones read it in either theme. */
export function QrCode({ value, label, className }: { value: string; label?: string; className?: string }) {
  const svg = useMemo(() => renderSVG(value, { border: 2, pixelSize: 6, blackColor: "#000", whiteColor: "#fff" }), [value]);
  // uqr builds the SVG from the QR matrix itself; nothing user-supplied is interpolated as markup.
  return (
    <div
      className={cn("size-44 overflow-hidden rounded-lg bg-white p-1 [&>svg]:h-full [&>svg]:w-full", className)}
      role="img"
      aria-label={label ?? `QR code for ${value}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
