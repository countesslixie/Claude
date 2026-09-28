import * as React from "react";
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink",
        "outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400",
        className,
      )}
      {...props}
    />
  );
}
