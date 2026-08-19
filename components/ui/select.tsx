import * as React from "react";
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900",
        "outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500",
        className,
      )}
      {...props}
    />
  );
}
