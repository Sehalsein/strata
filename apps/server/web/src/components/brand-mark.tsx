/** The Strata mark: three bands (sand, apricot, rust) that form a play triangle. */
export function BrandMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="292 254 476 516" width={size} height={size} aria-hidden="true">
      <g strokeLinejoin="round" strokeWidth="16">
        <path d="M300 262 L552 399 L300 399 Z" fill="var(--sand)" stroke="var(--sand)" />
        <path d="M300 443 L633 443 L760 512 L633 581 L300 581 Z" fill="var(--primary)" stroke="var(--primary)" />
        <path d="M300 625 L552 625 L300 762 Z" fill="var(--rust)" stroke="var(--rust)" />
      </g>
    </svg>
  );
}
