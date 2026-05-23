import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Film } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  to: string;
  title: string;
  imageUrl?: string | null;
  subtitle?: string | null;
};

export const PosterCard = ({ to, title, imageUrl, subtitle }: Props) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <Link
      to={to as any}
      className="group block w-[180px] shrink-0 transition-transform duration-150 hover:-translate-y-1 active:scale-[0.97]"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg border border-border bg-muted">
        {imageUrl ? (
          <>
            {!loaded && (
              <div className="absolute inset-0 animate-pulse bg-muted" />
            )}
            <img
              src={imageUrl}
              alt={title}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
              className={cn(
                "h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-80",
                loaded ? "opacity-100" : "opacity-0",
              )}
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
            <Film className="h-12 w-12" />
          </div>
        )}
      </div>
      <div className="mt-2 line-clamp-2 text-sm font-medium">{title}</div>
      {subtitle ? (
        <div className="line-clamp-1 text-xs text-muted-foreground">
          {subtitle}
        </div>
      ) : null}
    </Link>
  );
};

export const PosterSkeleton = () => (
  <div className="w-[180px] shrink-0">
    <div className="aspect-[2/3] animate-pulse rounded-lg bg-muted" />
    <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-muted" />
    <div className="mt-1 h-3 w-1/2 animate-pulse rounded bg-muted" />
  </div>
);
