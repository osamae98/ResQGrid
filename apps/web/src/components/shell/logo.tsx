import { cn } from "@/lib/utils";

export const APP_NAME = "RescueGrid";

/** The signal-point mark: a call coming in. Same drawing as app/icon.svg. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--color-critical)" />
      <circle cx="16" cy="16" r="3.4" fill="#fff" />
      <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
        <path d="M10.3 10.3a8 8 0 0 0 0 11.4M21.7 10.3a8 8 0 0 1 0 11.4" />
        <path d="M6.4 6.4a13.5 13.5 0 0 0 0 19.2M25.6 6.4a13.5 13.5 0 0 1 0 19.2" opacity=".5" />
      </g>
    </svg>
  );
}

/**
 * The one RescueGrid logo, used on every surface. `product` names the part you're in
 * (Console, Report) next to the wordmark.
 */
export function Logo({
  size = "md",
  hideWordmark,
  product,
  className,
}: {
  size?: "sm" | "md" | "lg";
  hideWordmark?: "sm" | boolean;
  product?: string;
  className?: string;
}) {
  const box = { sm: "size-6", md: "size-7", lg: "size-8" }[size];
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark className={box} />
      <span className={cn("flex items-baseline gap-1.5", hideWordmark === true && "sr-only", hideWordmark === "sm" && "max-sm:sr-only")}>
        <span dir="ltr">{APP_NAME}</span>
        {product ? <span className="font-normal text-muted-foreground">{product}</span> : null}
      </span>
    </span>
  );
}
