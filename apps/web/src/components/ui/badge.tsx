import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3", {
  variants: {
    variant: {
      default: "bg-muted text-foreground",
      outline: "border border-border text-foreground",
      critical: "bg-critical text-white",
      high: "bg-high text-white",
      medium: "bg-medium text-black",
      low: "bg-low text-white",
      available: "bg-available/15 text-available",
      busy: "bg-busy/15 text-busy",
      stale: "bg-stale/20 text-muted-foreground",
      warning: "bg-high/15 text-high",
      danger: "bg-critical/15 text-critical",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...p} />;
}
