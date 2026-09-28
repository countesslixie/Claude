import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink",
        "placeholder:text-faint outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400",
        className,
      )}
      {...props}
    />
  );
}
