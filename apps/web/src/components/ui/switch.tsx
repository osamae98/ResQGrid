"use client";

import * as S from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...p }: S.SwitchProps) {
  return (
    <S.Root
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-input transition-colors data-[state=checked]:bg-available disabled:opacity-50", className)}
      {...p}
    >
      <S.Thumb className="block size-5 rounded-full bg-white shadow transition-transform ltr:translate-x-0.5 ltr:data-[state=checked]:translate-x-[22px] rtl:-translate-x-0.5 rtl:data-[state=checked]:-translate-x-[22px]" />
    </S.Root>
  );
}
