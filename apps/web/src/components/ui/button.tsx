import { Slot } from "radix-ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        outline: "border border-input bg-card hover:bg-accent",
        secondary: "bg-muted text-foreground hover:bg-muted/70",
        ghost: "hover:bg-accent",
        link: "text-primary underline-offset-4 hover:underline",
        success: "bg-available text-white hover:bg-available/90",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6",
        xl: "h-14 px-6 text-lg [&_svg]:size-5",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Tooltip text. Icon-only buttons (size="icon") get their aria-label as a tooltip automatically. */
  tooltip?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, tooltip, ...props }, ref) => {
  const Comp = asChild ? Slot.Root : "button";
  const el = <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  const tip = tooltip ?? (size === "icon" ? props["aria-label"] : undefined);
  if (!tip) return el;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
});
Button.displayName = "Button";
export { buttonVariants };
