"use client";

import { Check, PlusCircle } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export type FacetOption = { value: string; label: string; icon?: React.ReactNode; count?: number };

/**
 * Multi-select column filter (shadcn data-table "faceted filter" pattern): a dashed button that opens a
 * checkbox list with live counts; chosen values show as chips on the button.
 */
export function FacetFilter({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: FacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const tr = useT();
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const chosen = options.filter((o) => selected.includes(o.value));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-9 border-dashed", selected.length && "border-solid border-primary/50")}>
          <PlusCircle className="size-4" />
          {title}
          {chosen.length ? (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
              {chosen.length > 2 ? (
                <span className="rounded bg-primary/10 px-1.5 text-xs font-medium text-primary">
                  {chosen.length} {tr("selected")}
                </span>
              ) : (
                chosen.map((o) => (
                  <span key={o.value} className="rounded bg-primary/10 px-1.5 text-xs font-medium text-primary">
                    {o.label}
                  </span>
                ))
              )}
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <ul role="listbox" aria-multiselectable aria-label={title} className="flex flex-col">
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <li key={o.value} role="option" aria-selected={on}>
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                  <Checkbox checked={on} onCheckedChange={() => toggle(o.value)} />
                  {o.icon}
                  <span className="flex-1">{o.label}</span>
                  {o.count !== undefined ? <span className="text-xs tabular-nums text-muted-foreground">{o.count}</span> : null}
                </label>
              </li>
            );
          })}
        </ul>
        {selected.length ? (
          <button type="button" onClick={() => onChange([])} className="mt-1 flex w-full items-center justify-center gap-1 border-t px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Check className="size-3.5" /> {tr("Clear filter")}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
