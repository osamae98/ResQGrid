import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";

/** The one ResQGrid mark, used on every surface (console, login, public form, status page). */
export function Logo({ size = "md", hideWordmark, className }: { size?: "sm" | "md" | "lg"; hideWordmark?: "sm" | boolean; className?: string }) {
  const box = { sm: "size-6 rounded", md: "size-7 rounded-md", lg: "size-8 rounded-md" }[size];
  const icon = { sm: "size-3.5", md: "size-4", lg: "size-4" }[size];
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className={cn("grid shrink-0 place-items-center bg-critical text-white", box)} aria-hidden>
        <Activity className={icon} />
      </span>
      <span className={cn(hideWordmark === true && "sr-only", hideWordmark === "sm" && "max-sm:sr-only")}>ResQGrid</span>
    </span>
  );
}
