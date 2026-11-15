import * as React from "react";
import { cn } from "@/lib/utils";
import { Select as SelectRoot, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

const field = "w-full rounded-md border border-input bg-card px-3 text-sm placeholder:text-muted-foreground disabled:opacity-50 aria-invalid:border-destructive";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, "h-9", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(field, "min-h-20 py-2", className)} {...p} />
));
Textarea.displayName = "Textarea";

// Radix Select can't use "" as an item value; "" stays the app's "nothing chosen / all" value.
const EMPTY = "__rq_empty__";

type Opt = { value: string; label: React.ReactNode; disabled?: boolean };

function textOf(n: React.ReactNode): string {
  if (n === null || n === undefined || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (React.isValidElement(n)) return textOf((n.props as { children?: React.ReactNode }).children);
  return "";
}

/** Reads <option> children (including ones inside arrays and fragments) into items. */
function collectOptions(children: React.ReactNode, out: Opt[] = []): Opt[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const el = child as React.ReactElement<{ value?: string | number; children?: React.ReactNode; disabled?: boolean }>;
    if (el.type === React.Fragment) collectOptions(el.props.children, out);
    // Like a native <option>, no value attribute means the value is its text.
    else if (el.type === "option")
      out.push({ value: String(el.props.value ?? textOf(el.props.children)), label: el.props.children, disabled: el.props.disabled });
  });
  return out;
}

/**
 * shadcn Select with the same API as a native <select>: pass <option> children, read e.target.value
 * in onChange. Keeps the 30 call sites unchanged while giving one styled, RTL-aware, keyboard-friendly control.
 */
export function Select({
  value,
  onChange,
  children,
  className,
  disabled,
  name,
  id,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value?: string | number;
  onChange?: (e: { target: { value: string; name?: string } }) => void;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const opts = collectOptions(children);
  const current = value === undefined ? undefined : String(value) === "" ? EMPTY : String(value);
  return (
    <SelectRoot value={current} disabled={disabled} name={name} onValueChange={(v) => onChange?.({ target: { value: v === EMPTY ? "" : v, name } })}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("w-full bg-card text-start", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        {opts.map((o) => (
          <SelectItem key={o.value || EMPTY} value={o.value === "" ? EMPTY : o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-xs font-medium text-muted-foreground", className)} {...p} />;
}

/** Label wraps the control so it gets an accessible name without wiring ids. */
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
